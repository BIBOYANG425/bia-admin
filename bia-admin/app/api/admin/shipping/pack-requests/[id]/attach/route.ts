// /api/admin/shipping/pack-requests/[id]/attach
// POST — body { shipment_id }. Atomically (one txn, via admin_attach_pack_request
// RPC) attaches every received_cn parcel in this pack request to the shipment
// (received_cn -> in_transit, actor_role='admin'). The request is marked
// 'approved' ONLY when every parcel attached (migration 20260703000001, SR-1);
// a partial attach keeps the request attachable so the officer re-runs it once
// the remaining parcels are received — no more stranded skipped parcels. editor+.
// Ported from bia-roommate (Phase-3 slice 5): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

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

    // Move the parcels AND approve the request atomically (one transaction) —
    // see admin_attach_pack_request. Returns { total, attached, request }; a
    // request with no parcels returns total=0 and is NOT approved.
    const { data: result, error: rpcErr } = await admin.rpc(
      "admin_attach_pack_request",
      {
        p_request_id: id,
        p_shipment_id: shipmentId,
        p_actor_user_id: auth.user.id,
      },
    );
    if (rpcErr) {
      // The RPC re-checks request/shipment status under a row lock (race
      // backstop for the route prechecks above) and raises a recognizable token
      // — map those to clean 4xx instead of a generic 500.
      const msg = rpcErr.message ?? "";
      if (msg.includes("pack_request_not_found")) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (msg.includes("pack_request_not_attachable")) {
        return NextResponse.json(
          { error: "request_not_attachable" },
          { status: 409 },
        );
      }
      if (msg.includes("shipment_not_attachable")) {
        return NextResponse.json(
          { error: "shipment_not_attachable" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "attach_failed", details: rpcErr.message },
        { status: 500 },
      );
    }
    const r = (result ?? {}) as {
      total?: number;
      attached?: number;
      request?: unknown;
    };
    if ((r.total ?? 0) === 0) {
      return NextResponse.json({ error: "no_parcels" }, { status: 400 });
    }

    // attached < total means some parcels were ineligible (not received_cn) and
    // the RPC skipped them — the request then stays attachable for a re-run.
    // Compute `approved` from the counts (not the RPC's key) so this route
    // stays correct against the pre-20260703000001 RPC, which always approved.
    const attachedCount = r.attached ?? 0;
    const total = r.total ?? 0;
    const skipped = total - attachedCount;
    const approved = total > 0 && attachedCount === total;
    await writeAudit({
      admin_email: auth.user.email,
      action: "pack_request.attach",
      entity_type: "pack_request",
      entity_id: id,
      payload: { shipment_id: shipmentId, attached: attachedCount, skipped, approved },
    });
    return NextResponse.json({
      attached: attachedCount,
      skipped,
      approved,
      request: r.request ?? null,
    });
  });
}
