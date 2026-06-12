// lib/marketplace/cap-enforcement.ts
// Marketplace approval cap: at most MARKETPLACE_WEEKLY_CAP student-submitted
// events may be APPROVED in any trailing 7-day window. Counts approvals via
// event_submissions (events has no approved_at column). Pure of HTTP — the
// approve route calls this and maps an over-cap result to HTTP 429.
import type { SupabaseClient } from "@supabase/supabase-js";

export const MARKETPLACE_WEEKLY_CAP = 20;

/** Count submissions approved in the trailing 7 days. Throws on query error. */
export async function countApprovedSubmissionsThisWeek(
  admin: SupabaseClient,
): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("event_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved")
    .gte("decided_at", since);
  if (error) throw new Error((error as { message?: string }).message ?? "cap_query_failed");
  return count ?? 0;
}
