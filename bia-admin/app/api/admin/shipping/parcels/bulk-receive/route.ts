// /api/admin/shipping/parcels/bulk-receive
// POST { items: [{ id, weight_grams? }] } — bulk-advance 'expected' parcels to
// 'received_cn' via the set-based admin_bulk_receive RPC: ONE transaction, one
// round trip, eligibility checked in the UPDATE itself (no stale-snapshot
// race), per-row triggers keep the parcel_events audit chain. editor+.
// Forward-only: only 'expected' parcels are received; anything else is skipped
// (idempotent re-run, no backward moves). Takes an explicit id list — never
// "all matching a query". Returns + audits the exact updated/skipped/failed id
// sets so a partial outcome is always reconstructable (SR-3).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const Body = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        weight_grams: z.number().int().min(0).nullable().optional(),
      }),
    )
    .min(1)
    .max(300),
});

type Item = z.infer<typeof Body>["items"][number];

interface BulkResult {
  updated_ids: string[];
  skipped_ids: string[];
  failed_ids: string[];
}

// Transitional fallback: the sequential per-parcel path, used only until
// migration 20260703000002 (admin_bulk_receive) is applied to prod. Safe to
// run concurrently — admin_patch_parcel's actor GUCs are transaction-local.
// Remove once the migration is confirmed applied.
async function legacyLoopReceive(
  admin: SupabaseClient,
  items: Item[],
  actorUserId: string,
): Promise<BulkResult> {
  const { data: existing } = await admin
    .from("parcels")
    .select("id, status")
    .in(
      "id",
      items.map((i) => i.id),
    );
  const statusById = new Map<string, string>(
    (existing ?? []).map((p) => [p.id as string, p.status as string]),
  );

  const updated_ids: string[] = [];
  const skipped_ids: string[] = [];
  const failed_ids: string[] = [];
  for (const item of items) {
    if (statusById.get(item.id) !== "expected") {
      skipped_ids.push(item.id);
      continue;
    }
    const patch: Record<string, unknown> = { status: "received_cn" };
    if (item.weight_grams != null) patch.weight_grams = item.weight_grams;
    const { error: rpcErr } = await admin.rpc("admin_patch_parcel", {
      p_id: item.id,
      p_actor_user_id: actorUserId,
      p_patch: patch,
    });
    if (rpcErr) {
      console.error("[bulk-receive]", item.id, rpcErr.message);
      failed_ids.push(item.id);
      continue;
    }
    updated_ids.push(item.id);
  }
  return { updated_ids, skipped_ids, failed_ids };
}

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const items = parsed.data.items;
    const admin = createBiaServiceRoleClient();

    let result: BulkResult;
    const { data, error } = await admin.rpc("admin_bulk_receive", {
      p_items: items,
      p_actor_user_id: auth.user.id,
    });
    if (error) {
      // PGRST202 = function not found (migration not applied yet) → fall back
      // to the per-parcel loop instead of breaking the intake desk.
      const missingFn =
        error.code === "PGRST202" ||
        (error.message ?? "").includes("Could not find the function");
      if (!missingFn) {
        return NextResponse.json(
          { error: "receive_failed", details: error.message },
          { status: 500 },
        );
      }
      console.warn(
        "[bulk-receive] admin_bulk_receive missing — using legacy loop (apply migration 20260703000002)",
      );
      result = await legacyLoopReceive(admin, items, auth.user.id);
    } else {
      const r = (data ?? {}) as {
        updated_ids?: string[];
        skipped_ids?: string[];
      };
      result = {
        updated_ids: r.updated_ids ?? [],
        skipped_ids: r.skipped_ids ?? [],
        failed_ids: [],
      };
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "parcel.bulk_receive",
      entity_type: "parcel",
      entity_id: null,
      payload: {
        count: items.length,
        updated: result.updated_ids.length,
        skipped: result.skipped_ids.length,
        failed: result.failed_ids.length,
        updated_ids: result.updated_ids,
        skipped_ids: result.skipped_ids,
        failed_ids: result.failed_ids,
      },
    });

    return NextResponse.json({
      updated: result.updated_ids.length,
      skipped: result.skipped_ids.length,
      failed: result.failed_ids.length,
      total: items.length,
      updated_ids: result.updated_ids,
      skipped_ids: result.skipped_ids,
      failed_ids: result.failed_ids,
    });
  });
}
