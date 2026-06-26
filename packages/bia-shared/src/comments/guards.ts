/* ── Article comment guards / projections ───────────────────────────────────
 * Small pure helpers shared between the admin moderation surface and the
 * public comment UI. toPublicComment is the public-leak boundary: anything
 * that reads full rows server-side can hand the public site a structurally
 * safe object that simply cannot carry moderation fields.
 * ────────────────────────────────────────────────────────────────────────── */

import type { ArticleComment, PublicArticleComment } from "./types";

/** True if the comment is publicly visible (not hidden/deleted by an officer). */
export function isPublicComment(c: Pick<ArticleComment, "status">): boolean {
  return c.status === "visible";
}

/**
 * Project a full row down to the public-safe subset, dropping status,
 * moderated_at, moderated_by and author_member_id. Use this before any full
 * row reaches an anon/public surface.
 */
export function toPublicComment(c: ArticleComment): PublicArticleComment {
  return {
    id: c.id,
    article_id: c.article_id,
    author_name: c.author_name,
    body: c.body,
    created_at: c.created_at,
  };
}
