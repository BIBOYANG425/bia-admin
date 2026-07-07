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
import { removeArticleCoverByUrl } from "@/lib/admin/article-covers";
import { findAvailableSlug } from "@/lib/admin/slug";
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
  // Explicit publish schedule. `null` clears it. A non-null value flips the
  // article to `published` once it passes, via the publish_scheduled_articles
  // pg_cron job; the manual publish flow never sets this.
  scheduled_publish_at: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
});

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
      .select("id, slug, status, title, cover_image_url")
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
        const slugResult = await findAvailableSlug(admin, base, { excludeId: id });
        if (slugResult.error) {
          return NextResponse.json(
            { error: "slug_lookup_failed", details: slugResult.error.message },
            { status: 500 },
          );
        }
        update.slug = slugResult.slug;
      }
    }

    if (parsed.data.html !== undefined) {
      // Sanitize, then drop any <img> without a usable src — same policy as
      // POST. Authors fill missing slots via the editor's missing-images
      // panel; anything still empty at save time is stripped.
      const htmlClean = stripEmptyImages(sanitizeArticleHtml(parsed.data.html));
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

    // Detect a cover change so we can clean up the previous storage object
    // after the write succeeds (the old cover would otherwise orphan).
    let previousCover: string | null = null;
    let coverChanged = false;
    if (parsed.data.cover_image_url !== undefined) {
      update.cover_image_url = parsed.data.cover_image_url;
      coverChanged = (existing.cover_image_url ?? null) !== parsed.data.cover_image_url;
      if (coverChanged) previousCover = existing.cover_image_url ?? null;
    }

    if (parsed.data.scheduled_publish_at !== undefined) {
      update.scheduled_publish_at = parsed.data.scheduled_publish_at;
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

    // Append a revision snapshot of the saved state. Best-effort: a failed
    // history insert must not break the save the user just performed.
    try {
      const { error: revisionError } = await admin
        .from("article_revisions")
        .insert({
          article_id: id,
          title: data.title,
          body: data.html_clean,
          language: data.language,
          status: data.status,
          edited_by: auth.adminUser.id,
        });
      if (revisionError) {
        console.error("article revision insert failed:", revisionError.message);
      }
    } catch (revisionError) {
      console.error("article revision insert threw:", revisionError);
    }

    // Remove the previous cover object now that the row points elsewhere.
    if (coverChanged && previousCover) {
      await removeArticleCoverByUrl(previousCover);
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

    const { data: existing, error: lookupError } = await admin
      .from("articles")
      .select("id, cover_image_url")
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

    const { error } = await admin.from("articles").delete().eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: "delete_failed", details: error.message },
        { status: 500 },
      );
    }

    // Clean up the orphaned cover object (article_revisions cascade-delete on
    // the row, so only the storage object needs explicit removal).
    await removeArticleCoverByUrl(existing.cover_image_url ?? null);

    await writeAudit({
      admin_email: auth.user.email,
      action: "article.delete",
      entity_type: "article",
      entity_id: id,
    });

    return NextResponse.json({ ok: true });
  });
}
