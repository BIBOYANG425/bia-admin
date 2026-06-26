/* ── Article comments shared types ──────────────────────────────────────────
 * Reader comments on published blog articles, shared between admin.uscbia.com
 * (bia-admin moderation) and uscbia.com (bia-roommate public comment UI). Pure
 * type/data only — no runtime deps, no side effects. Table:
 * public.article_comments (migration 20260624000007). Post-moderation model:
 * comments are visible by default; officers hide/delete from /admin/comments.
 * ────────────────────────────────────────────────────────────────────────── */

export const COMMENT_STATUS_VALUES = ["visible", "hidden", "deleted"] as const;
export type CommentStatus = (typeof COMMENT_STATUS_VALUES)[number];

/** DB CHECK bounds on article_comments.body (char_length). */
export const COMMENT_MIN_LEN = 1;
export const COMMENT_MAX_LEN = 2000;

/**
 * Full comment row — admin / service-role surfaces only. Carries the
 * moderation fields, so NEVER hand this shape to a public (anon) surface; use
 * PublicArticleComment / toPublicComment for uscbia.com.
 */
export interface ArticleComment {
  id: string;
  article_id: string;
  author_name: string | null;
  author_member_id: string | null;
  body: string;
  status: CommentStatus;
  created_at: string;
  moderated_at: string | null;
  moderated_by: string | null;
}

/**
 * Public-safe projection — the only shape that should reach uscbia.com. Drops
 * every moderation/internal field (status, moderated_*, author_member_id) so a
 * hidden/deleted comment or a moderator identity can never leak to anon
 * readers. Mirrors the anon SELECT RLS (status = 'visible' only).
 */
export interface PublicArticleComment {
  id: string;
  article_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
}
