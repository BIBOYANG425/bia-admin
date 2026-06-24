// /api/admin/shipping/shipments/[id]/attach
// POST — body { parcel_ids: string[] }; sets shipment_id and auto-bumps
// received_cn -> in_transit via admin_attach_parcels_to_shipment RPC (which
// stamps actor_role='admin' on the event log). editor+.
// The received_cn -> in_transit bump fires the live enqueue_parcel_notification
// trigger, so attaching QUEUES one 'in_transit' shipping_notifications row per
// parcel (delivered to students once the george notifier is enabled).
// Ported from bia-roommate (Phase-3 slice 4): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { logAdminAction } from "@/lib/audit/log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const AttachBody = z.object({
  parcel_ids: z.array(z.string()).min(1).max(500),
});

// Only batches that have not yet left China accept new parcels.
const ATTACHABLE_SHIPMENT_STATUS = new Set(["forming", "sealed"]);

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = AttachBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();

    // Verify the shipment exists and still accepts parcels before the update.
    const { data: shipment } = await admin
      .from("shipments")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    if (!shipment) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!ATTACHABLE_SHIPMENT_STATUS.has(shipment.status as string)) {
      return NextResponse.json(
        { error: "shipment_not_attachable", status: shipment.status },
        { status: 409 },
      );
    }

    const { data, error } = await admin.rpc(
      "admin_attach_parcels_to_shipment",
      {
        p_parcel_ids: parsed.data.parcel_ids,
        p_shipment_id: id,
        p_actor_user_id: auth.user.id,
      },
    );
    if (error) {
      return NextResponse.json(
        { error: "attach_failed", details: error.message },
        { status: 500 },
      );
    }
    // updated < requested means some parcels were not received_cn and the RPC
    // skipped them (no backward move) — report the skipped count.
    const updatedCount = (data as number | null) ?? 0;
    const skippedCount = parsed.data.parcel_ids.length - updatedCount;
    await logAdminAction({
      adminEmail: auth.user.email,
      action: "shipment.attach",
      entityType: "shipment",
      entityId: id,
      payload: {
        shipment_id: id,
        requested: parsed.data.parcel_ids.length,
        updated: updatedCount,
        skipped: skippedCount,
      },
    });
    return NextResponse.json({
      updated: updatedCount,
      skipped: skippedCount,
    });
  });
}
