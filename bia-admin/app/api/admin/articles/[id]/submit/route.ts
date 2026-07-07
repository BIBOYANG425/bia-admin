import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { findAvailableSlug } from "@/lib/admin/slug";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();
    const { data: existing, error: lookupError } = await admin
      .from("articles")
      .select("id, status, slug")
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
    if (existing.status !== "draft") {
      return NextResponse.json(
        { error: "invalid_transition", from: existing.status },
        { status: 409 },
      );
    }

    const slugResult = await findAvailableSlug(admin, existing.slug, { excludeId: id });
    if (slugResult.error) {
      return NextResponse.json(
        { error: "slug_lookup_failed", details: slugResult.error.message },
        { status: 500 },
      );
    }
    const finalSlug = slugResult.slug;

    const { data, error } = await admin
      .from("articles")
      .update({
        slug: finalSlug,
        status: "in_review",
        submitted_at: new Date().toISOString(),
        submitted_by: auth.adminUser.id,
        // Clear any prior rejection — once the article moves forward the note
        // no longer applies. Audit log retains the history.
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
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
      action: "article.submit",
      entity_type: "article",
      entity_id: id,
    });

    return NextResponse.json(data);
  });
}
