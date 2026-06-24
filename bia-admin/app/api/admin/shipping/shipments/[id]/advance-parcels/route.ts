// /api/admin/shipping/shipments/[id]/advance-parcels
// POST — body { status, only_forward? }. Bulk-advance EVERY parcel attached to
// this shipment to the target parcel status, in one action (closes the
// "same-flight batch: one action -> all parcels updated" gap). editor+.
//
// Each parcel is patched via the admin_patch_parcel RPC so the parcel_events
// audit chain is preserved (actor_role='admin') exactly as a single-parcel
// edit. Branch statuses (lost/returned/disputed) are skipped, and by default
// only parcels EARLIER than the target on the happy path are advanced (no
// accidental backward moves). NOTE: each admin_patch_parcel UPDATE fires the
// live enqueue_parcel_notification trigger, so a bulk advance QUEUES one
// shipping_notifications row per parcel. Nothing is delivered yet (the george
// consumer is gated off), but the whole batch drains to students once the
// notifier is enabled — a bulk advance is NOT silent.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import {
  PARCEL_STATUS_VALUES,
  PARCEL_STEPS,
  type ParcelStatus,
} from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const STATUS_SET = new Set<string>(PARCEL_STATUS_VALUES);

const Body = z.object({
  status: z.string(),
  only_forward: z.boolean().optional(),
});

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const target = parsed.data.status;
    if (!STATUS_SET.has(target)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    // Default to forward-only so a "pickup_open" bulk push never drags an
    // already-picked_up parcel backward.
    const onlyForward = parsed.data.only_forward !== false;
    const targetIdx = PARCEL_STEPS.indexOf(target as ParcelStatus);

    const admin = createBiaServiceRoleClient();

    const { data: shipment } = await admin
      .from("shipments")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!shipment) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const { data: parcels, error } = await admin
      .from("parcels")
      .select("id, status")
      .eq("shipment_id", id);
    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }

    let updated = 0;
    let skipped = 0;
    const failed: string[] = [];

    // Sequential: admin_patch_parcel sets per-transaction actor GUCs on the
    // pooled connection, so we avoid concurrent calls clobbering each other.
    for (const p of parcels ?? []) {
      const curIdx = PARCEL_STEPS.indexOf(p.status as ParcelStatus);
      // Skip if already at target, or (forward-only) if off the happy path
      // (branch statuses → curIdx<0) or already at/past the target.
      if (p.status === target) {
        skipped++;
        continue;
      }
      if (onlyForward && targetIdx >= 0 && (curIdx < 0 || curIdx >= targetIdx)) {
        skipped++;
        continue;
      }
      const { error: rpcErr } = await admin.rpc("admin_patch_parcel", {
        p_id: p.id,
        p_actor_user_id: auth.user.id,
        p_patch: { status: target },
      });
      if (rpcErr) {
        failed.push(p.id);
        continue;
      }
      updated++;
    }

    return NextResponse.json({
      updated,
      skipped,
      failed: failed.length,
      total: parcels?.length ?? 0,
    });
  });
}
