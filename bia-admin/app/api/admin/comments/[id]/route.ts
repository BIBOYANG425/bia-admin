// /api/admin/comments/[id]
// PATCH  — moderate a comment: set status visible | hidden | deleted (editor+).
// DELETE — hard-delete a comment row (super_admin).
// Public posting + reading happens on uscbia.com via RLS; this route is the
// officer moderation surface. Both actions are audited.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const PatchBody = z.object({
  status: z.enum(["visible", "hidden", "deleted"]),
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

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("article_comments")
      .update({
        status: parsed.data.status,
        moderated_at: new Date().toISOString(),
        moderated_by: auth.user.email,
      })
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
      action: "article_comment.moderate",
      entity_type: "article_comment",
      entity_id: id,
      payload: { status: parsed.data.status },
    });

    return NextResponse.json(data);
  });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();
    const { error } = await admin
      .from("article_comments")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: "delete_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "article_comment.delete",
      entity_type: "article_comment",
      entity_id: id,
      payload: {},
    });

    return NextResponse.json({ ok: true });
  });
}
