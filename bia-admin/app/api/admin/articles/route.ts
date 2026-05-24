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

const ArticleStatus = z.enum([
  "draft",
  "in_review",
  "published",
  "unpublished",
]);

const CreateArticleBody = z.object({
  title: z.string().trim().min(1).max(200),
  html: z.string().min(1).max(200_000),
  language: z.enum(["en", "zh"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  cover_image_url: z.string().url().nullable().optional(),
});

function slugCandidates(base: string): string[] {
  return [base, ...Array.from({ length: 99 }, (_, index) => `${base}-${index + 2}`)];
}

async function availableSlug(base: string): Promise<
  | { slug: string; error: null }
  | { slug: null; error: { message?: string } }
> {
  const admin = createBiaServiceRoleClient();
  const { data, error } = await admin
    .from("articles")
    .select("slug, status")
    .in("slug", slugCandidates(base));

  if (error) return { slug: null, error };

  // Only non-draft slugs are unique-constrained. Drafts can share slugs,
  // so they don't count as collisions when creating a new draft.
  const taken = new Set(
    (data ?? [])
      .filter((row: { status: string }) => row.status !== "draft")
      .map((row: { slug: string }) => row.slug),
  );
  return { slug: withCollisionSuffix(base, taken), error: null };
}

export async function GET(request: Request) {
  return withRole("viewer", async () => {
    const status = new URL(request.url).searchParams.get("status");
    const parsedStatus = status ? ArticleStatus.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    let query = admin
      .from("articles")
      .select(
        "id, slug, title, excerpt, cover_image_url, language, tags, author_id, status, submitted_at, published_at, unpublished_at, created_at, updated_at",
      )
      .order("updated_at", { ascending: false });

    if (parsedStatus?.success) {
      query = query.eq("status", parsedStatus.data);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ articles: data ?? [] });
  });
}

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

    const htmlClean = sanitizeArticleHtml(parsed.data.html);
    if (!htmlClean) {
      return NextResponse.json(
        { error: "empty_html_after_sanitize" },
        { status: 400 },
      );
    }

    const slugResult = await availableSlug(slugify(parsed.data.title));
    if (slugResult.error) {
      return NextResponse.json(
        { error: "slug_lookup_failed", details: slugResult.error.message },
        { status: 500 },
      );
    }

    const admin = createBiaServiceRoleClient();
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
