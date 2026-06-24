// /api/admin/shipping/pack-requests/[id]
// PATCH — update status / admin_note (editor+). shipment_id is intentionally
// NOT settable here: associating a request with a shipment must go through the
// /attach route, which also moves the parcels — setting shipment_id alone left
// the request pointing at a batch its parcels were never attached to.
// Ported from bia-roommate (Phase-3 slice 5): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { PACK_REQUEST_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";
import { logAdminAction } from "@/lib/audit/log";
import {
  checkTransition,
  PACK_REQUEST_TRANSITION,
} from "@/lib/shipping/transitions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const STATUS_SET = new Set<string>(PACK_REQUEST_STATUS_VALUES);

const PatchBody = z.object({
  status: z.string().optional(),
  admin_note: z.string().max(2000).nullable().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = PatchBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (!STATUS_SET.has(body.status)) {
        return NextResponse.json({ error: "invalid_status" }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.admin_note !== undefined) {
      patch.admin_note =
        typeof body.admin_note === "string"
          ? body.admin_note.trim() || null
          : null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();

    // Block status regressions / leaving a terminal state (transition policy).
    if (typeof patch.status === "string") {
      const { data: cur } = await admin
        .from("pack_requests")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (!cur) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const t = checkTransition(
        PACK_REQUEST_TRANSITION,
        cur.status as string,
        patch.status,
      );
      if (!t.ok) {
        return NextResponse.json(
          {
            error: "invalid_transition",
            detail: t.reason,
            from: cur.status,
            to: patch.status,
          },
          { status: 409 },
        );
      }
    }

    const { data, error } = await admin
      .from("pack_requests")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "update_failed", details: error.message },
        { status: 500 },
      );
    }
    await logAdminAction({
      adminEmail: auth.user.email,
      action: "pack_request.update",
      entityType: "pack_request",
      entityId: id,
      payload: { fields: Object.keys(patch), status: patch.status },
    });

    return NextResponse.json(data);
  });
}
