import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { requireRole } from "@/lib/auth/require-role";
import {
  MARKETPLACE_WEEKLY_CAP,
  countApprovedSubmissionsThisWeek,
} from "@/lib/marketplace/cap-enforcement";
import { MarketplaceQueue, type PendingSubmission } from "./MarketplaceQueue";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  await requireRole("viewer");

  const admin = createBiaServiceRoleClient();
  const { data, error } = await admin
    .from("event_submissions")
    .select("id, title, description, date, location, category, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    throw new Error(`Failed to load submissions: ${error.message}`);
  }
  const submissions = (data ?? []) as PendingSubmission[];
  const approvedThisWeek = await countApprovedSubmissionsThisWeek(admin);
  const capReached = approvedThisWeek >= MARKETPLACE_WEEKLY_CAP;

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">活动投稿审核</h1>
        <p className="text-sm text-muted-foreground">
          {submissions.length} 条待审核 · 本周已通过 {approvedThisWeek} / {MARKETPLACE_WEEKLY_CAP}
        </p>
      </header>
      {capReached ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          本周审核通过数已达上限（{MARKETPLACE_WEEKLY_CAP}）。通过按钮已禁用，下周重置。
        </div>
      ) : null}
      <MarketplaceQueue submissions={submissions} capReached={capReached} />
    </div>
  );
}
