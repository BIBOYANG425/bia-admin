// lib/shipping/__tests__/rpc.integration.test.ts
// Run: RUN_DB_TESTS=true pnpm exec vitest run lib/shipping/__tests__/rpc.integration.test.ts
// Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY —
// pointed at a DEV BRANCH with migrations 20260703000001–20260703000005
// applied. DO NOT run against prod: it inserts (marked, cleaned-up) fixture
// rows into parcels/shipments/pack_requests.
//
// WHY (SR-4): the shipping RPC/trigger SQL is the most-patched correctness
// surface in the repo (rewritten 5× in one week, PRs #45–#49, then hardened
// again in the 2026-07-03 refinement) and every route test mocks rpc() — so
// nothing executable pinned what the SQL actually does. These are the
// invariants that, if regressed, corrupt batch manifests or resurrect
// delivered parcels. Modeled on lib/matching/__tests__/rpc.integration.test.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";

const RUN = process.env.RUN_DB_TESTS === "true";
const d = describe.skipIf(!RUN);

function env(k: string): string {
  if (process.env[k]) return process.env[k]!;
  for (const p of [".env.local", "bia-admin/.env.local"]) {
    if (!fs.existsSync(p)) continue;
    const line = fs
      .readFileSync(p, "utf8")
      .split("\n")
      .find((l) => l.startsWith(k + "="));
    if (line) return line.slice(k.length + 1).trim();
  }
  throw new Error(`missing env ${k}`);
}

const MARK = `sr4test-${process.pid}`;
const ACTOR = "00000000-0000-4000-8000-000000000001"; // fixture actor uuid

let admin: SupabaseClient;
const ids = {
  parcels: [] as string[],
  shipments: [] as string[],
  packRequests: [] as string[],
};

async function mkShipment(status: string): Promise<string> {
  const { data, error } = await admin
    .from("shipments")
    .insert({ name: `${MARK}-ship-${ids.shipments.length}`, status })
    .select("id")
    .single();
  if (error) throw new Error(`mkShipment: ${error.message}`);
  ids.shipments.push(data.id);
  return data.id;
}

async function mkParcel(
  status: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; pickup_token: string }> {
  const { data, error } = await admin
    .from("parcels")
    .insert({
      member_id: MARK,
      description: `${MARK} parcel`,
      status,
      ...extra,
    })
    .select("id, pickup_token")
    .single();
  if (error) throw new Error(`mkParcel: ${error.message}`);
  ids.parcels.push(data.id);
  return data;
}

async function parcelRow(id: string) {
  const { data, error } = await admin
    .from("parcels")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

d("shipping RPC invariants (live DB)", () => {
  beforeAll(() => {
    admin = createClient(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
  });

  afterAll(async () => {
    if (!admin) return;
    // FK-safe cleanup order; parcel_events cascades from parcels.
    if (ids.parcels.length) {
      await admin
        .from("shipping_notifications")
        .delete()
        .in("parcel_id", ids.parcels);
      await admin
        .from("pack_request_parcels")
        .delete()
        .in("parcel_id", ids.parcels);
    }
    if (ids.packRequests.length)
      await admin.from("pack_requests").delete().in("id", ids.packRequests);
    if (ids.parcels.length)
      await admin.from("parcels").delete().in("id", ids.parcels);
    if (ids.shipments.length)
      await admin.from("shipments").delete().in("id", ids.shipments);
  });

  // ── admin_patch_parcel (20260703000001) ────────────────────────────────
  it("patch: stamps received_at on →received_cn only when NULL; explicit wins", async () => {
    const p = await mkParcel("expected");
    const { data } = await admin.rpc("admin_patch_parcel", {
      p_id: p.id,
      p_actor_user_id: ACTOR,
      p_patch: { status: "received_cn" },
    });
    expect(data.received_at).toBeTruthy();

    const explicit = "2026-01-01T00:00:00+00:00";
    const p2 = await mkParcel("expected");
    const { data: d2 } = await admin.rpc("admin_patch_parcel", {
      p_id: p2.id,
      p_actor_user_id: ACTOR,
      p_patch: { status: "received_cn", received_at: explicit },
    });
    expect(new Date(d2.received_at).getTime()).toBe(
      new Date(explicit).getTime(),
    );
  });

  it("patch: cannot resurrect picked_up (parcel_terminal), EXCEPT →disputed (D3)", async () => {
    const p = await mkParcel("picked_up");
    const back = await admin.rpc("admin_patch_parcel", {
      p_id: p.id,
      p_actor_user_id: ACTOR,
      p_patch: { status: "in_transit" },
    });
    expect(back.error?.message).toContain("parcel_terminal");

    const contest = await admin.rpc("admin_patch_parcel", {
      p_id: p.id,
      p_actor_user_id: ACTOR,
      p_patch: { status: "disputed" },
    });
    expect(contest.error).toBeNull();
    expect(contest.data.status).toBe("disputed");
  });

  it("patch: rejects multi-step regressions and shipment_id keys", async () => {
    const p = await mkParcel("arrived_us");
    const reg = await admin.rpc("admin_patch_parcel", {
      p_id: p.id,
      p_actor_user_id: ACTOR,
      p_patch: { status: "expected" },
    });
    expect(reg.error?.message).toContain("invalid_transition");

    const mass = await admin.rpc("admin_patch_parcel", {
      p_id: p.id,
      p_actor_user_id: ACTOR,
      p_patch: { shipment_id: "00000000-0000-4000-8000-000000000009" },
    });
    expect(mass.error?.message).toContain("shipment_id_not_patchable");
  });

  // ── admin_advance_parcels (20260624000005) ─────────────────────────────
  it("advance: forward-only matrix never touches picked_up; branch target hits all non-delivered", async () => {
    const ship = await mkShipment("departed_cn");
    const fixture: Record<string, string> = {};
    for (const s of [
      "expected",
      "received_cn",
      "in_transit",
      "arrived_us",
      "picked_up",
    ]) {
      fixture[s] = (await mkParcel(s, { shipment_id: ship })).id;
    }

    const fwd = await admin.rpc("admin_advance_parcels", {
      p_shipment_id: ship,
      p_target: "arrived_us",
      p_only_forward: true,
      p_actor_user_id: ACTOR,
    });
    expect(fwd.data).toMatchObject({ total: 5, updated: 3, skipped: 2 });
    expect((await parcelRow(fixture.expected)).status).toBe("arrived_us");
    expect((await parcelRow(fixture.picked_up)).status).toBe("picked_up");

    const branch = await admin.rpc("admin_advance_parcels", {
      p_shipment_id: ship,
      p_target: "lost",
      p_only_forward: true,
      p_actor_user_id: ACTOR,
    });
    // Everything except the delivered parcel flips to lost.
    expect(branch.data).toMatchObject({ total: 5, updated: 4 });
    expect((await parcelRow(fixture.picked_up)).status).toBe("picked_up");
  });

  // ── attach / detach (20260623000001 + 20260703000001/5) ────────────────
  it("attach: in-txn shipment re-check rejects a departed batch; detach reverses attach", async () => {
    const gone = await mkShipment("departed_cn");
    const p = await mkParcel("received_cn");
    const rejected = await admin.rpc("admin_attach_parcels_to_shipment", {
      p_parcel_ids: [p.id],
      p_shipment_id: gone,
      p_actor_user_id: ACTOR,
    });
    expect(rejected.error?.message).toContain("shipment_not_attachable");

    const open = await mkShipment("forming");
    const attached = await admin.rpc("admin_attach_parcels_to_shipment", {
      p_parcel_ids: [p.id],
      p_shipment_id: open,
      p_actor_user_id: ACTOR,
    });
    expect(attached.data).toBe(1);
    expect(await parcelRow(p.id)).toMatchObject({
      status: "in_transit",
      shipment_id: open,
    });

    const detached = await admin.rpc("admin_detach_parcels_from_shipment", {
      p_parcel_ids: [p.id],
      p_shipment_id: open,
      p_actor_user_id: ACTOR,
    });
    expect(detached.data).toBe(1);
    expect(await parcelRow(p.id)).toMatchObject({
      status: "received_cn",
      shipment_id: null,
    });
  });

  // ── admin_attach_pack_request (20260703000001) ─────────────────────────
  it("pack-request attach: partial does NOT approve; full re-run approves", async () => {
    const ship = await mkShipment("forming");
    const ready = await mkParcel("received_cn");
    const late = await mkParcel("expected");
    const { data: req, error: reqErr } = await admin
      .from("pack_requests")
      .insert({ member_id: MARK, status: "pending" })
      .select("id")
      .single();
    if (reqErr) throw new Error(reqErr.message);
    ids.packRequests.push(req.id);
    const { error: linkErr } = await admin
      .from("pack_request_parcels")
      .insert([
        { request_id: req.id, parcel_id: ready.id },
        { request_id: req.id, parcel_id: late.id },
      ]);
    if (linkErr) throw new Error(linkErr.message);

    const partial = await admin.rpc("admin_attach_pack_request", {
      p_request_id: req.id,
      p_shipment_id: ship,
      p_actor_user_id: ACTOR,
    });
    expect(partial.data).toMatchObject({
      total: 2,
      attached: 1,
      approved: false,
    });
    expect(partial.data.request.status).toBe("pending"); // still attachable

    // Late parcel arrives → re-run completes and approves.
    await admin.rpc("admin_patch_parcel", {
      p_id: late.id,
      p_actor_user_id: ACTOR,
      p_patch: { status: "received_cn" },
    });
    const full = await admin.rpc("admin_attach_pack_request", {
      p_request_id: req.id,
      p_shipment_id: ship,
      p_actor_user_id: ACTOR,
    });
    // attached counts only the NEWLY moved straggler; approved is judged on
    // "every linked parcel sits on this batch" (20260703000006 — writing
    // this very test exposed that judging on the newly-moved count left
    // re-runs unable to ever approve).
    expect(full.data).toMatchObject({ total: 2, attached: 1, approved: true });
    expect(full.data.request.status).toBe("approved");
  });

  it("one-open-pack-request trigger raises 23505 on a second open request", async () => {
    const p = await mkParcel("received_cn");
    const mk = async () => {
      const { data, error } = await admin
        .from("pack_requests")
        .insert({ member_id: MARK, status: "pending" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids.packRequests.push(data.id);
      return data.id;
    };
    const r1 = await mk();
    const r2 = await mk();
    const first = await admin
      .from("pack_request_parcels")
      .insert({ request_id: r1, parcel_id: p.id });
    expect(first.error).toBeNull();
    const second = await admin
      .from("pack_request_parcels")
      .insert({ request_id: r2, parcel_id: p.id });
    expect(second.error?.code).toBe("23505");
  });

  // ── pickup confirm / revert (20260620000004 + 20260703000003) ──────────
  it("confirm-by-token: wrong token, wrong status, then idempotent double-confirm", async () => {
    const p = await mkParcel("arrived_us");
    const bad = await admin.rpc("admin_confirm_pickup_by_token", {
      p_parcel_id: p.id,
      p_token: "00000000",
      p_actor_user_id: ACTOR,
    });
    expect(bad.error?.message).toContain("bad_token");

    const early = await mkParcel("in_transit");
    const notEligible = await admin.rpc("admin_confirm_pickup_by_token", {
      p_parcel_id: early.id,
      p_token: early.pickup_token,
      p_actor_user_id: ACTOR,
    });
    expect(notEligible.error?.message).toContain("not_pickup_eligible");

    const ok = await admin.rpc("admin_confirm_pickup_by_token", {
      p_parcel_id: p.id,
      p_token: p.pickup_token,
      p_actor_user_id: ACTOR,
    });
    expect(ok.data.status).toBe("picked_up");
    const again = await admin.rpc("admin_confirm_pickup_by_token", {
      p_parcel_id: p.id,
      p_token: p.pickup_token,
      p_actor_user_id: ACTOR,
    });
    expect(again.error).toBeNull(); // idempotent
    expect(again.data.status).toBe("picked_up");
  });

  it("revert-pickup requires a reason, restores arrived_us, and notes the timeline", async () => {
    const p = await mkParcel("picked_up");
    const noReason = await admin.rpc("admin_revert_pickup", {
      p_parcel_id: p.id,
      p_reason: " ",
      p_actor_user_id: ACTOR,
    });
    expect(noReason.error?.message).toContain("reason_required");

    const ok = await admin.rpc("admin_revert_pickup", {
      p_parcel_id: p.id,
      p_reason: "扫错了",
      p_actor_user_id: ACTOR,
    });
    expect(ok.data.status).toBe("arrived_us");

    const { data: ev } = await admin
      .from("parcel_events")
      .select("note, to_status")
      .eq("parcel_id", p.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(ev?.to_status).toBe("arrived_us");
    expect(ev?.note).toContain("撤销取件");
  });

  // ── bulk receive (20260703000002) ──────────────────────────────────────
  it("bulk-receive returns exact updated/skipped id sets in one call", async () => {
    const a = await mkParcel("expected");
    const b = await mkParcel("received_cn"); // already received → skipped
    const { data, error } = await admin.rpc("admin_bulk_receive", {
      p_items: [
        { id: a.id, weight_grams: 1200 },
        { id: b.id },
      ],
      p_actor_user_id: ACTOR,
    });
    expect(error).toBeNull();
    expect(data.updated).toBe(1);
    expect(data.updated_ids).toEqual([a.id]);
    expect(data.skipped_ids).toEqual([b.id]);
    expect(await parcelRow(a.id)).toMatchObject({
      status: "received_cn",
      weight_grams: 1200,
    });
  });

  // ── reassign (20260703000005) + token uniqueness (20260703000003) ──────
  it("reassign updates member_id, reports unlinked, blocks picked_up", async () => {
    const p = await mkParcel("received_cn");
    const { data, error } = await admin.rpc("admin_reassign_parcel_student", {
      p_parcel_id: p.id,
      p_member_id: `${MARK}-nobody`,
      p_actor_user_id: ACTOR,
    });
    expect(error).toBeNull();
    expect(data.linked).toBe(false); // no students row for the marker id
    expect(data.parcel.member_id).toBe(`${MARK}-nobody`);

    const done = await mkParcel("picked_up");
    const blocked = await admin.rpc("admin_reassign_parcel_student", {
      p_parcel_id: done.id,
      p_member_id: MARK,
      p_actor_user_id: ACTOR,
    });
    expect(blocked.error?.message).toContain("parcel_terminal");
  });

  it("pickup_token: inserting a duplicate token gets regenerated by the trigger", async () => {
    const p1 = await mkParcel("expected");
    const p2 = await mkParcel("expected", { pickup_token: p1.pickup_token });
    expect(p2.pickup_token).not.toBe(p1.pickup_token);
    expect(p2.pickup_token).toMatch(/^[0-9a-f]{8}$/);
  });
});
