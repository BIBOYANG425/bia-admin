// /api/admin/shipping/parcels/[id]/revert-pickup
// POST { reason } — super_admin-only sanctioned undo for a wrong pickup
// confirmation (SR-2, decision D3): picked_up -> arrived_us via
// admin_revert_pickup, which requires a reason and stamps it onto the
// parcel_events timeline. Surfaced ONLY on the parcel detail page — the pickup
// desk itself never reverts.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Body = z.object({ reason: z.string().trim().min(2).max(500) });

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "reason_required", detail: "请填写撤销原因（至少 2 个字符）" },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin.rpc("admin_revert_pickup", {
      p_parcel_id: id,
      p_reason: parsed.data.reason,
      p_actor_user_id: auth.user.id,
    });

    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("not_found")) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (msg.includes("not_picked_up")) {
        return NextResponse.json(
          { error: "not_picked_up", detail: "包裹不在「已取件」状态，无需撤销" },
          { status: 409 },
        );
      }
      if (msg.includes("reason_required")) {
        return NextResponse.json({ error: "reason_required" }, { status: 400 });
      }
      return NextResponse.json(
        { error: "revert_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "parcel.pickup_revert",
      entity_type: "parcel",
      entity_id: id,
      payload: { reason: parsed.data.reason },
    });

    return NextResponse.json({ parcel: data });
  });
}
