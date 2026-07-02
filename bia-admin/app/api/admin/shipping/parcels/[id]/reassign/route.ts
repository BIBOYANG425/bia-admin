// /api/admin/shipping/parcels/[id]/reassign
// POST { member_id } — re-point a parcel at a (different) student via
// admin_reassign_parcel_student: updates member_id and re-derives the
// students link (student_id/user_id), so notifications / student visibility /
// pickup QR / payment dunning follow the correction. Blocked once picked_up.
// Writes a parcel_events timeline note in the RPC. editor+. (SR-7 — parcel
// identity used to be immutable after creation, so a typo'd member_id was a
// permanent mis-route.)

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Body = z.object({ member_id: z.string().trim().min(1).max(120) });

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

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin.rpc("admin_reassign_parcel_student", {
      p_parcel_id: id,
      p_member_id: parsed.data.member_id,
      p_actor_user_id: auth.user.id,
    });

    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("not_found")) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (msg.includes("parcel_terminal")) {
        return NextResponse.json(
          {
            error: "parcel_terminal",
            detail: "包裹已取件，身份已结算，不能重新指派",
          },
          { status: 409 },
        );
      }
      if (msg.includes("member_id_required")) {
        return NextResponse.json({ error: "invalid_body" }, { status: 400 });
      }
      return NextResponse.json(
        { error: "reassign_failed", details: error.message },
        { status: 500 },
      );
    }

    const r = (data ?? {}) as {
      parcel?: unknown;
      linked?: boolean;
      prior_member_id?: string | null;
    };
    await writeAudit({
      admin_email: auth.user.email,
      action: "parcel.reassign",
      entity_type: "parcel",
      entity_id: id,
      payload: {
        from_member_id: r.prior_member_id ?? null,
        to_member_id: parsed.data.member_id,
        linked: r.linked === true,
      },
    });

    return NextResponse.json({
      parcel: r.parcel ?? null,
      linked: r.linked === true,
      prior_member_id: r.prior_member_id ?? null,
    });
  });
}
