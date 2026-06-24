import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    const admin = createBiaServiceRoleClient();
    const { data: existing, error: lookupError } = await admin
      .from("articles")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { error: "lookup_failed", details: lookupError.message },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (existing.status !== "in_review") {
      return NextResponse.json(
        { error: "invalid_transition", from: existing.status },
        { status: 409 },
      );
    }

    const { data, error } = await admin
      .from("articles")
      .update({
        status: "draft",
        submitted_at: null,
        submitted_by: null,
        // Record the rejection so the editor banner can show the author what
        // changed. Cleared by the submit handler when the article moves
        // forward again.
        rejected_at: new Date().toISOString(),
        rejected_by: auth.adminUser.id,
        rejection_reason: reason ?? null,
        // Clear any pending schedule so a rejected draft isn't auto-published.
        scheduled_publish_at: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "update_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "article.reject",
      entity_type: "article",
      entity_id: id,
      payload: reason ? { reason } : {},
    });

    return NextResponse.json(data);
  });
}
