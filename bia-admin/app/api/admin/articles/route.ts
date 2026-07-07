import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import {
  deriveExcerpt,
  sanitizeArticleHtml,
  slugify,
  stripEmptyImages,
} from "@biboyang425/bia-shared/articles";
import { writeAudit } from "@/lib/admin/audit-log";
import { findAvailableSlug } from "@/lib/admin/slug";
import { withRole } from "@/lib/auth/require-role";

const CreateArticleBody = z.object({
  title: z.string().trim().min(1).max(200),
  html: z.string().min(1).max(200_000),
  language: z.enum(["en", "zh"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  cover_image_url: z.string().url().nullable().optional(),
});

export async function POST(request: Request) {
  return withRole("editor", async (ctx) => {
    const json = await request.json().catch(() => null);
    const parsed = CreateArticleBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Sanitize, then drop any <img> tags that arrived without a usable src
    // (authors can fill them via the editor's missing-images panel; anything
    // still empty at save time is removed rather than shipped broken).
    const htmlClean = stripEmptyImages(sanitizeArticleHtml(parsed.data.html));
    if (!htmlClean) {
      return NextResponse.json(
        { error: "empty_html_after_sanitize" },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const slugResult = await findAvailableSlug(admin, slugify(parsed.data.title));
    if (slugResult.error) {
      return NextResponse.json(
        { error: "slug_lookup_failed", details: slugResult.error.message },
        { status: 500 },
      );
    }
    const { data, error } = await admin
      .from("articles")
      .insert({
        slug: slugResult.slug,
        title: parsed.data.title,
        html_clean: htmlClean,
        excerpt: deriveExcerpt(htmlClean),
        cover_image_url: parsed.data.cover_image_url ?? null,
        language: parsed.data.language,
        tags: parsed.data.tags,
        author_id: ctx.adminUser.id,
        status: "draft",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "insert_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: ctx.user.email,
      action: "article.create",
      entity_type: "article",
      entity_id: data.id,
      payload: { slug: data.slug, language: data.language },
    });

    return NextResponse.json(data, { status: 201 });
  });
}
