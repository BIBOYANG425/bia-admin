/**
 * Shared date/datetime formatters for the admin dashboard.
 *
 * Both functions use zh-CN locale with short-month style — the dominant
 * format across shipping and related pages. Call sites that intentionally
 * differ (en-US, no-year datetime, etc.) keep their own local formatters
 * and are listed in the task-10 report.
 */

const DATE_FMT = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Format an ISO date string as e.g. "2024年3月15日". Returns "—" for falsy input. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATE_FMT.format(new Date(iso));
}

/** Format an ISO datetime string as e.g. "2024年3月15日 14:30". Returns "—" for falsy input. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATETIME_FMT.format(new Date(iso));
}
