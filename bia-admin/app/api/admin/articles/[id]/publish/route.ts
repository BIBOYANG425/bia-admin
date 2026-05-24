import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withCollisionSuffix } from "@biboyang425/bia-shared/articles";
import { writeAudit } from "@/lib/admin/audit-log";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
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
    if (existing.status !== "in_review" && existing.status !== "unpublished") {
      return NextResponse.json(
        { error: "invalid_transition", from: existing.status },
        { status: 409 },
      );
    }

    const base = existing.slug;
    const candidates = [
      base,
      ...Array.from({ length: 99 }, (_, i) => `${base}-${i + 2}`),
    ];
    const { data: clashes, error: slugError } = await admin
      .from("articles")
      .select("slug, status, id")
      .in("slug", candidates);
    if (slugError) {
      return NextResponse.json(
        { error: "slug_lookup_failed", details: slugError.message },
        { status: 500 },
      );
    }
    const taken = new Set(
      (clashes ?? [])
        .filter(
          (r: { id: string; status: string }) =>
            r.id !== id && r.status !== "draft",
        )
        .map((r: { slug: string }) => r.slug),
    );
    const finalSlug = withCollisionSuffix(base, taken);

    const { data, error } = await admin
      .from("articles")
      .update({
        slug: finalSlug,
        status: "published",
        published_at: new Date().toISOString(),
        published_by: auth.adminUser.id,
        unpublished_at: null,
        unpublished_by: null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "publish_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "article.publish",
      entity_type: "article",
      entity_id: id,
      payload: { slug: finalSlug },
    });

    return NextResponse.json(data);
  });
}
