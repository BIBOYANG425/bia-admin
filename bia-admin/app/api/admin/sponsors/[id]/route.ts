// /api/admin/sponsors/[id]
// PATCH  — update a sponsor (any field, incl. active toggle / retire) (editor+).
// DELETE — hard-delete a sponsor row (super_admin).
// Both actions are audited.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const TIERS = ["event", "recruiting", "local_service", "payment"] as const;

const PatchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    tier: z.enum(TIERS).nullable().optional(),
    contact: z.string().max(500).nullable().optional(),
    logo_url: z.string().max(1000).nullable().optional(),
    website_url: z.string().max(1000).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    display_order: z.number().int().optional(),
  })
  .strip();

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
    const b = parsed.data;

    const update: Record<string, unknown> = {};
    if (b.name !== undefined) update.name = b.name.trim();
    if (b.tier !== undefined) update.tier = b.tier ?? null;
    if (b.contact !== undefined) update.contact = b.contact?.trim() || null;
    if (b.logo_url !== undefined) update.logo_url = b.logo_url?.trim() || null;
    if (b.website_url !== undefined)
      update.website_url = b.website_url?.trim() || null;
    if (b.notes !== undefined) update.notes = b.notes?.trim() || null;
    if (b.active !== undefined) update.active = b.active;
    if (b.display_order !== undefined) update.display_order = b.display_order;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "empty_update" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("sponsors")
      .update(update)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "update_failed", details: error.message },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "sponsor.update",
      entity_type: "sponsor",
      entity_id: id,
      payload: update,
    });

    return NextResponse.json(data);
  });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();
    const { error } = await admin.from("sponsors").delete().eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: "delete_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "sponsor.delete",
      entity_type: "sponsor",
      entity_id: id,
      payload: {},
    });

    return NextResponse.json({ ok: true });
  });
}
