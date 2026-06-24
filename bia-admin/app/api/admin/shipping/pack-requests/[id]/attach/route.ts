// /api/admin/shipping/pack-requests/[id]/attach
// POST — body { shipment_id }. Attaches every parcel in this pack request to
// the shipment via admin_attach_parcels_to_shipment RPC (auto-bumps
// received_cn -> in_transit, stamps actor_role='admin'), then sets the pack
// request's shipment_id + status='approved'. editor+.
// Ported from bia-roommate (Phase-3 slice 5): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { logAdminAction } from "@/lib/audit/log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const AttachBody = z.object({
  shipment_id: z.string().min(1),
});

// Parcels can only be attached to a batch that has not yet left China, and only
// from a pack request that has not yet been processed. These guards stop a
// stale/duplicate attach from re-pointing parcels into a sealed-and-gone batch
// or resurrecting a declined/cancelled/shipped request back to 'approved'.
const ATTACHABLE_SHIPMENT_STATUS = new Set(["forming", "sealed"]);
const ATTACHABLE_REQUEST_STATUS = new Set(["pending", "contacted"]);

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
    const shipmentId = parsed.data.shipment_id.trim();
    if (!shipmentId) {
      return NextResponse.json({ error: "shipment_id_required" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();

    // Validate the shipment exists.
    const { data: shipment } = await admin
      .from("shipments")
      .select("id, status")
      .eq("id", shipmentId)
      .maybeSingle();
    if (!shipment) {
      return NextResponse.json({ error: "shipment_not_found" }, { status: 404 });
    }
    if (!ATTACHABLE_SHIPMENT_STATUS.has(shipment.status as string)) {
      return NextResponse.json(
        { error: "shipment_not_attachable", status: shipment.status },
        { status: 409 },
      );
    }

    // Validate pack request exists and is still in an attachable state.
    const { data: req } = await admin
      .from("pack_requests")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    if (!req) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!ATTACHABLE_REQUEST_STATUS.has(req.status as string)) {
      return NextResponse.json(
        { error: "request_not_attachable", status: req.status },
        { status: 409 },
      );
    }

    const { data: links } = await admin
      .from("pack_request_parcels")
      .select("parcel_id")
      .eq("request_id", id);
    const parcelIds = (links ?? []).map((l) => l.parcel_id);
    if (parcelIds.length === 0) {
      return NextResponse.json({ error: "no_parcels" }, { status: 400 });
    }

    const { data: attached, error: rpcErr } = await admin.rpc(
      "admin_attach_parcels_to_shipment",
      {
        p_parcel_ids: parcelIds,
        p_shipment_id: shipmentId,
        p_actor_user_id: auth.user.id,
      },
    );
    if (rpcErr) {
      return NextResponse.json(
        { error: "attach_failed", details: rpcErr.message },
        { status: 500 },
      );
    }

    const { data: updated, error: updErr } = await admin
      .from("pack_requests")
      .update({ shipment_id: shipmentId, status: "approved" })
      .eq("id", id)
      .select()
      .single();
    if (updErr) {
      return NextResponse.json(
        { error: "update_failed", details: updErr.message },
        { status: 500 },
      );
    }

    // attached < parcelIds.length means some parcels were ineligible
    // (not received_cn) and the RPC skipped them — surface that to the officer.
    const attachedCount = (attached as number | null) ?? 0;
    await logAdminAction({
      adminEmail: auth.user.email,
      action: "pack_request.attach",
      entityType: "pack_request",
      entityId: id,
      payload: {
        shipment_id: shipmentId,
        attached: attachedCount,
        skipped: parcelIds.length - attachedCount,
      },
    });
    return NextResponse.json({
      attached: attachedCount,
      skipped: parcelIds.length - attachedCount,
      request: updated,
    });
  });
}
