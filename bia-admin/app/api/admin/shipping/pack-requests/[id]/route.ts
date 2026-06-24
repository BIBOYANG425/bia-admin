// /api/admin/shipping/pack-requests/[id]
// PATCH — update status / admin_note / shipment_id (editor+).
// Ported from bia-roommate (Phase-3 slice 5): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { PACK_REQUEST_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";
import { logAdminAction } from "@/lib/audit/log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const STATUS_SET = new Set<string>(PACK_REQUEST_STATUS_VALUES);

const PatchBody = z.object({
  status: z.string().optional(),
  admin_note: z.string().max(2000).nullable().optional(),
  shipment_id: z.string().nullable().optional(),
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
    if (body.shipment_id !== undefined) {
      patch.shipment_id =
        typeof body.shipment_id === "string" && body.shipment_id
          ? body.shipment_id
          : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
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
