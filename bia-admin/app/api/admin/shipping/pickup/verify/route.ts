// /api/admin/shipping/pickup/verify
// POST — officer 核销: resolve a pickup code to an arrived_us parcel and confirm
// it picked_up via admin_confirm_pickup_by_token (actor_role='admin'). (editor+)
//
// The student shows an 8-char pickup_token (as a code, and later a QR). The
// officer types/scans it here. We scope the lookup to status='arrived_us' so a
// code only matches a pickup-eligible parcel; an exact RPC token re-check
// guards the transition.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { logAdminAction } from "@/lib/audit/log";

const Body = z.object({ code: z.string().trim().min(1).max(64) });

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "请输入取件码" }, { status: 400 });
    }
    const code = parsed.data.code;
    const admin = createBiaServiceRoleClient();

    // Only pickup-eligible parcels can match a code.
    const { data: matches, error } = await admin
      .from("parcels")
      .select("id, member_id, description")
      .eq("pickup_token", code)
      .eq("status", "arrived_us");

    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }
    if (!matches || matches.length === 0) {
      return NextResponse.json(
        { error: "码无效，或包裹不在「到达美国」状态" },
        { status: 404 },
      );
    }
    if (matches.length > 1) {
      return NextResponse.json(
        {
          error: "多个包裹匹配此码，请在包裹详情页手动核销",
          matches: matches.map((m) => ({ id: m.id, member_id: m.member_id })),
        },
        { status: 409 },
      );
    }

    const parcel = matches[0];
    const { data, error: rpcErr } = await admin.rpc(
      "admin_confirm_pickup_by_token",
      { p_parcel_id: parcel.id, p_token: code, p_actor_user_id: auth.user.id },
    );

    if (rpcErr) {
      const msg = rpcErr.message ?? "";
      if (msg.includes("bad_token"))
        return NextResponse.json({ error: "取件码不匹配" }, { status: 409 });
      if (msg.includes("not_pickup_eligible"))
        return NextResponse.json(
          { error: "包裹不在可取件状态" },
          { status: 409 },
        );
      if (msg.includes("not_found"))
        return NextResponse.json({ error: "包裹不存在" }, { status: 404 });
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    // Best-effort audit (admin_audit_log.entity_type is free text).
    await logAdminAction({
      adminEmail: auth.user.email,
      action: "parcel.pickup_verify",
      entityType: "parcel",
      entityId: parcel.id,
      payload: { code },
    });

    return NextResponse.json({
      parcel: data,
      member_id: parcel.member_id,
      description: parcel.description,
    });
  });
}
