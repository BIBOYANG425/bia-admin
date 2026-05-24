import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import {
  deriveExcerpt,
  sanitizeArticleHtml,
  slugify,
  withCollisionSuffix,
} from "@biboyang425/bia-shared/articles";
import { writeAudit } from "@/lib/admin/audit-log";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const PatchArticleBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  html: z.string().min(1).max(200_000).optional(),
  language: z.enum(["en", "zh"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  cover_image_url: z.string().url().nullable().optional(),
});

function slugCandidates(base: string): string[] {
  return [base, ...Array.from({ length: 99 }, (_, index) => `${base}-${index + 2}`)];
}

export async function GET(_request: Request, ctx: RouteContext) {
  return withRole("viewer", async () => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("articles")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json(data);
  });
}

export async function PATCH(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = PatchArticleBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const { data: existing, error: lookupError } = await admin
      .from("articles")
      .select("id, slug, status, title")
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
    if (existing.status === "published" && auth.role !== "super_admin") {
      return NextResponse.json({ error: "published_locked" }, { status: 403 });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) {
      update.title = parsed.data.title;

      if (existing.status === "draft" && parsed.data.title !== existing.title) {
        const base = slugify(parsed.data.title);
        const { data: clashes, error: slugError } = await admin
          .from("articles")
          .select("id, slug")
          .in("slug", slugCandidates(base));

        if (slugError) {
          return NextResponse.json(
            { error: "slug_lookup_failed", details: slugError.message },
            { status: 500 },
          );
        }

        const taken = new Set(
          (clashes ?? [])
            .filter((row: { id: string }) => row.id !== id)
            .map((row: { slug: string }) => row.slug),
        );
        update.slug = withCollisionSuffix(base, taken);
      }
    }

    if (parsed.data.html !== undefined) {
      const htmlClean = sanitizeArticleHtml(parsed.data.html);
      if (!htmlClean) {
        return NextResponse.json(
          { error: "empty_html_after_sanitize" },
          { status: 400 },
        );
      }
      update.html_clean = htmlClean;
      update.excerpt = deriveExcerpt(htmlClean);
    }
    if (parsed.data.language !== undefined) update.language = parsed.data.language;
    if (parsed.data.tags !== undefined) update.tags = parsed.data.tags;
    if (parsed.data.cover_image_url !== undefined) {
      update.cover_image_url = parsed.data.cover_image_url;
    }

    const fields = Object.keys(update);
    if (fields.length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("articles")
      .update(update)
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
      action: "article.update",
      entity_type: "article",
      entity_id: id,
      payload: { fields },
    });

    return NextResponse.json(data);
  });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();
    const { error } = await admin.from("articles").delete().eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: "delete_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "article.delete",
      entity_type: "article",
      entity_id: id,
    });

    return NextResponse.json({ ok: true });
  });
}
