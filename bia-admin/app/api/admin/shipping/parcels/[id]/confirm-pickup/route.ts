// /api/admin/shipping/parcels/[id]/confirm-pickup
// POST { force? } — officer confirms pickup for THIS specific parcel (editor+).
// Resolves the verify-route 409 dead-end ("多个包裹匹配此码，请在包裹详情页手动核销"):
// the officer opens the exact parcel and confirms here. The parcel's own
// pickup_token is read server-side and passed to admin_confirm_pickup_by_token,
// so the officer never has to re-type the code.
// D2 (SR-2): an unpaid amount owed holds the confirm (200 requires_payment)
// until the caller re-POSTs with force:true.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Body = z.object({ force: z.boolean().optional() });

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    // Body is optional (legacy callers POST with none).
    const json = await request.json().catch(() => ({}));
    const parsed = Body.safeParse(json ?? {});
    const force = parsed.success && parsed.data.force === true;
    const admin = createBiaServiceRoleClient();

    const { data: parcel, error: lookupError } = await admin
      .from("parcels")
      .select(
        "id, status, pickup_token, member_id, amount_owed_cents, paid_at, updated_at",
      )
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
    if (parcel.status === "picked_up") {
      // Distinguish who confirmed (student self-confirm vs desk) — see verify.
      const { data: ev } = await admin
        .from("parcel_events")
        .select("actor_role, created_at")
        .eq("parcel_id", id)
        .eq("to_status", "picked_up")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const when = ev?.created_at ?? parcel.updated_at;
      const by =
        ev?.actor_role === "user"
          ? "学生在网站上自行确认"
          : ev?.actor_role === "admin"
            ? "运营核销"
            : "系统";
      return NextResponse.json(
        {
          error: "already_picked_up",
          message: `该包裹已是「已取件」（${by} · ${new Date(when).toLocaleString("zh-CN")}）`,
          picked_up_at: when,
          picked_up_by: ev?.actor_role ?? null,
        },
        { status: 409 },
      );
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

    const unpaid =
      parcel.amount_owed_cents != null &&
      parcel.amount_owed_cents > 0 &&
      parcel.paid_at == null;
    if (unpaid && !force) {
      return NextResponse.json({
        requires_payment: true,
        parcel_id: parcel.id,
        member_id: parcel.member_id,
        amount_owed_cents: parcel.amount_owed_cents,
      });
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
      payload: {
        member_id: parcel.member_id,
        via: "parcel_detail",
        forced_unpaid: unpaid && force ? parcel.amount_owed_cents : undefined,
      },
    });

    return NextResponse.json({ parcel: data });
  });
}
