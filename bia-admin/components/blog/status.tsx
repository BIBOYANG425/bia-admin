/**
 * Blog article status vocabulary: the status union, its labels and pill styles,
 * and the StatusPill component. Consolidated here so the editor, the list page,
 * and the revision-history page all read from one source instead of each
 * re-declaring identical maps.
 *
 * Header last reviewed: 2026-07-06
 */

export type ArticleStatus = "draft" | "in_review" | "published" | "unpublished";

export const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  unpublished: "Unpublished",
};

export const STATUS_STYLES: Record<ArticleStatus, string> = {
  draft: "border-zinc-200 bg-zinc-100 text-zinc-700",
  in_review: "border-amber-200 bg-amber-100 text-amber-800",
  published: "border-emerald-200 bg-emerald-100 text-emerald-800",
  unpublished: "border-slate-200 bg-slate-100 text-slate-700",
};

export function StatusPill({ status }: { status: ArticleStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
