// /api/admin/shipping/pickup/verify
// POST { code, force? } — officer 核销: resolve a pickup code and confirm the
// parcel picked_up via admin_confirm_pickup_by_token (actor_role='admin').
// (editor+)
//
// Desk flow (SR-2, decisions D2):
// * code resolves to one arrived_us parcel with no amount owed → confirm.
// * parcel owes money (amount_owed_cents > 0, unpaid) and force is not set →
//   200 { requires_payment } WITHOUT confirming; the desk UI shows an unpaid
//   banner and re-POSTs with force:true once the officer collects/decides.
// * already picked_up → 409 that says WHEN and WHO (student self-confirm vs
//   desk) so the officer isn't debugging a bare 404 with the parcel in hand.
// * on success the response carries the student's other arrived_us parcels so
//   a 3-parcel pickup is three scans with zero navigation.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { checkRateLimit } from "@/lib/rate-limit";

const Body = z.object({
  code: z.string().trim().min(1).max(64),
  force: z.boolean().optional(),
});

// Per-officer throttle. The lookup below matches a code against ANY parcel, so
// without a cap this endpoint is a brute-force oracle for the short pickup
// code. 30/min is far above real 核销 cadence (each verify is a physical
// hand-off) but makes guessing the code-space hopeless; failed attempts are
// audited below (parcel.pickup_verify_failed).
const VERIFY_LIMIT = 30;
const VERIFY_WINDOW_MS = 60_000;

interface ParcelRow {
  id: string;
  member_id: string;
  description: string | null;
  status: string;
  amount_owed_cents: number | null;
  paid_at: string | null;
  paid_method: string | null;
  updated_at: string;
}

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const rl = checkRateLimit(
      `pickup-verify:${auth.user.id}`,
      VERIFY_LIMIT,
      VERIFY_WINDOW_MS,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "核销尝试过于频繁，请稍后再试" },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
            ),
          },
        },
      );
    }

    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "请输入取件码" }, { status: 400 });
    }
    const code = parsed.data.code;
    const force = parsed.data.force === true;
    const admin = createBiaServiceRoleClient();

    // Store only the code suffix in audit payloads — a full code in the audit
    // log would be a replayable credential for anyone with audit access.
    const codeRef = { code_suffix: code.slice(-2), code_len: code.length };
    const auditFail = (
      reason: string,
      entityId: string | null,
      extra?: Record<string, unknown>,
    ) =>
      writeAudit({
        admin_email: auth.user.email,
        action: "parcel.pickup_verify_failed",
        entity_type: "parcel",
        entity_id: entityId,
        payload: { reason, ...codeRef, ...extra },
      });

    // Look the token up across ALL statuses so the desk can distinguish
    // "invalid code" from "already picked up" / "not arrived yet".
    const { data: rows, error } = await admin
      .from("parcels")
      .select(
        "id, member_id, description, status, amount_owed_cents, paid_at, paid_method, updated_at",
      )
      .eq("pickup_token", code);

    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }
    const all = (rows ?? []) as ParcelRow[];
    if (all.length === 0) {
      await auditFail("not_found", null);
      return NextResponse.json({ error: "码无效" }, { status: 404 });
    }

    const eligible = all.filter((p) => p.status === "arrived_us");

    if (eligible.length === 0) {
      const picked = all.find((p) => p.status === "picked_up");
      if (picked) {
        // Who confirmed it? actor_role 'user' = student self-confirm.
        const { data: ev } = await admin
          .from("parcel_events")
          .select("actor_role, created_at")
          .eq("parcel_id", picked.id)
          .eq("to_status", "picked_up")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const when = ev?.created_at ?? picked.updated_at;
        const by =
          ev?.actor_role === "user"
            ? "学生在网站上自行确认"
            : ev?.actor_role === "admin"
              ? "运营核销"
              : "系统";
        await auditFail("already_picked_up", picked.id, {
          picked_up_at: when,
          picked_up_by: ev?.actor_role ?? null,
        });
        return NextResponse.json(
          {
            error: "already_picked_up",
            message: `该包裹已是「已取件」（${by} · ${new Date(when).toLocaleString("zh-CN")}）`,
            member_id: picked.member_id,
            picked_up_at: when,
            picked_up_by: ev?.actor_role ?? null,
          },
          { status: 409 },
        );
      }
      const p = all[0];
      await auditFail("not_eligible", p.id, { status: p.status });
      return NextResponse.json(
        {
          error: "not_pickup_eligible",
          message: `包裹不在「到达美国」状态（当前：${p.status}）`,
          status: p.status,
        },
        { status: 409 },
      );
    }

    if (eligible.length > 1) {
      await auditFail("multi_match", null, {
        matches: eligible.map((m) => m.id),
      });
      return NextResponse.json(
        {
          error: "多个包裹匹配此码，请在包裹详情页手动核销",
          matches: eligible.map((m) => ({ id: m.id, member_id: m.member_id })),
        },
        { status: 409 },
      );
    }

    const parcel = eligible[0];
    const unpaid =
      parcel.amount_owed_cents != null &&
      parcel.amount_owed_cents > 0 &&
      parcel.paid_at == null;

    // D2: surface money at the hand-off moment. Hold the confirm until the
    // officer explicitly proceeds (they collect cash here, or wave it).
    if (unpaid && !force) {
      return NextResponse.json({
        requires_payment: true,
        parcel_id: parcel.id,
        member_id: parcel.member_id,
        description: parcel.description,
        amount_owed_cents: parcel.amount_owed_cents,
        paid_method: parcel.paid_method,
      });
    }

    const { data, error: rpcErr } = await admin.rpc(
      "admin_confirm_pickup_by_token",
      { p_parcel_id: parcel.id, p_token: code, p_actor_user_id: auth.user.id },
    );

    if (rpcErr) {
      const msg = rpcErr.message ?? "";
      if (msg.includes("bad_token")) {
        await auditFail("bad_token", parcel.id);
        return NextResponse.json({ error: "取件码不匹配" }, { status: 409 });
      }
      if (msg.includes("not_pickup_eligible")) {
        await auditFail("not_eligible", parcel.id);
        return NextResponse.json(
          { error: "包裹不在可取件状态" },
          { status: 409 },
        );
      }
      if (msg.includes("not_found")) {
        await auditFail("not_found", parcel.id);
        return NextResponse.json({ error: "包裹不存在" }, { status: 404 });
      }
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    // The student's other pickup-eligible parcels — the desk shows "还有 N 件"
    // so multi-parcel students hand over everything in one visit.
    const { data: remaining } = await admin
      .from("parcels")
      .select("id, description, amount_owed_cents, paid_at")
      .eq("member_id", parcel.member_id)
      .eq("status", "arrived_us")
      .neq("id", parcel.id);

    await writeAudit({
      admin_email: auth.user.email,
      action: "parcel.pickup_verify",
      entity_type: "parcel",
      entity_id: parcel.id,
      payload: {
        ...codeRef,
        member_id: parcel.member_id,
        forced_unpaid: unpaid && force ? parcel.amount_owed_cents : undefined,
      },
    });

    return NextResponse.json({
      parcel: data,
      member_id: parcel.member_id,
      description: parcel.description,
      unpaid_confirmed: unpaid && force ? parcel.amount_owed_cents : null,
      remaining: (remaining ?? []).map((r) => ({
        id: r.id,
        description: r.description,
        unpaid:
          r.amount_owed_cents != null &&
          r.amount_owed_cents > 0 &&
          r.paid_at == null
            ? r.amount_owed_cents
            : null,
      })),
    });
  });
}
