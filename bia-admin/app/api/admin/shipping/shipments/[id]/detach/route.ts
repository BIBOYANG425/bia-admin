// /api/admin/shipping/shipments/[id]/detach
// POST — body { parcel_ids: string[] }; the exact inverse of /attach: parcels
// that are in_transit ON this shipment go back to received_cn + unassigned,
// via admin_detach_parcels_from_shipment (in-txn forming/sealed re-check under
// a shipment row lock). editor+. Gives officers a recovery path for a
// mis-attach without touching anything that already flew (SR-7).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DetachBody = z.object({
  parcel_ids: z.array(z.string().uuid()).min(1).max(500),
});

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = DetachBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin.rpc(
      "admin_detach_parcels_from_shipment",
      {
        p_parcel_ids: parsed.data.parcel_ids,
        p_shipment_id: id,
        p_actor_user_id: auth.user.id,
      },
    );
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("shipment_not_detachable")) {
        return NextResponse.json(
          {
            error: "shipment_not_detachable",
            detail: "批次已发出/归档，包裹不能移出",
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "detach_failed", details: error.message },
        { status: 500 },
      );
    }

    const updated = (data as number | null) ?? 0;
    const skipped = parsed.data.parcel_ids.length - updated;
    await writeAudit({
      admin_email: auth.user.email,
      action: "shipment.detach",
      entity_type: "shipment",
      entity_id: id,
      payload: {
        parcel_ids: parsed.data.parcel_ids,
        updated,
        skipped,
      },
    });
    return NextResponse.json({ updated, skipped });
  });
}
