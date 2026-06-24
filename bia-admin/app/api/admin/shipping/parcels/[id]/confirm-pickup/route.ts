// /api/admin/shipping/parcels/[id]/confirm-pickup
// POST — officer confirms pickup for THIS specific parcel (editor+). Resolves
// the verify-route 409 dead-end ("多个包裹匹配此码，请在包裹详情页手动核销"): the
// officer opens the exact parcel and confirms here. The parcel's own
// pickup_token is read server-side and passed to admin_confirm_pickup_by_token,
// so the officer never has to re-type the code.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const { data: parcel, error: lookupError } = await admin
      .from("parcels")
      .select("id, status, pickup_token, member_id")
      .eq("id", id)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { error: "lookup_failed", details: lookupError.message },
        { status: 500 },
      );
    }
    if (!parcel) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (parcel.status !== "arrived_us") {
      return NextResponse.json(
        { error: "包裹不在「到达美国」状态，无法核销", status: parcel.status },
        { status: 409 },
      );
    }
    if (!parcel.pickup_token) {
      return NextResponse.json(
        { error: "该包裹尚未生成取件码" },
        { status: 409 },
      );
    }

    const { data, error: rpcErr } = await admin.rpc(
      "admin_confirm_pickup_by_token",
      {
        p_parcel_id: parcel.id,
        p_token: parcel.pickup_token,
        p_actor_user_id: auth.user.id,
      },
    );

    if (rpcErr) {
      const msg = rpcErr.message ?? "";
      if (msg.includes("not_pickup_eligible"))
        return NextResponse.json(
          { error: "包裹不在可取件状态" },
          { status: 409 },
        );
      if (msg.includes("not_found"))
        return NextResponse.json({ error: "包裹不存在" }, { status: 404 });
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "parcel.pickup_confirm",
      entity_type: "parcel",
      entity_id: parcel.id,
      payload: { member_id: parcel.member_id, via: "parcel_detail" },
    });

    return NextResponse.json({ parcel: data });
  });
}
