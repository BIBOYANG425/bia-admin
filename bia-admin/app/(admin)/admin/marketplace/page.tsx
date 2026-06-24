import Link from "next/link";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { requireRole } from "@/lib/auth/require-role";
import {
  MARKETPLACE_WEEKLY_CAP,
  countApprovedSubmissionsThisWeek,
} from "@/lib/marketplace/cap-enforcement";
import { cn } from "@/lib/utils";
import { MarketplaceQueue, type PendingSubmission } from "./MarketplaceQueue";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pending", label: "待审核" },
  { key: "approved", label: "已通过" },
  { key: "rejected", label: "已拒绝" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const TAB_SET = new Set<string>(TABS.map((t) => t.key));

interface DecidedRow {
  id: string;
  title: string;
  date: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  approved_event_id: string | null;
}

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

function fmt(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function MarketplacePage({ searchParams }: PageProps) {
  await requireRole("viewer");
  const sp = await searchParams;
  const tab: Tab =
    sp.status && TAB_SET.has(sp.status) ? (sp.status as Tab) : "pending";

  const admin = createBiaServiceRoleClient();
  const approvedThisWeek = await countApprovedSubmissionsThisWeek(admin);
  const capReached = approvedThisWeek >= MARKETPLACE_WEEKLY_CAP;

  let pending: PendingSubmission[] = [];
  let decided: DecidedRow[] = [];

  if (tab === "pending") {
    const { data, error } = await admin
      .from("event_submissions")
      .select("id, title, description, date, location, category, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(`Failed to load submissions: ${error.message}`);
    pending = (data ?? []) as PendingSubmission[];
  } else {
    const { data, error } = await admin
      .from("event_submissions")
      .select("id, title, date, decided_at, reject_reason, approved_event_id")
      .eq("status", tab)
      .order("decided_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`Failed to load submissions: ${error.message}`);
    decided = (data ?? []) as DecidedRow[];
  }

  return (
    <div className="space-y-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">活动投稿审核</h1>
        <p className="text-sm text-muted-foreground">
          本周已通过 {approvedThisWeek} / {MARKETPLACE_WEEKLY_CAP}
        </p>
      </header>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`?status=${t.key}`}
            className={cn(
              "border-b-2 px-3 py-1.5 text-sm transition-colors",
              tab === t.key
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "pending" ? (
        <>
          {capReached ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              本周审核通过数已达上限（{MARKETPLACE_WEEKLY_CAP}）。通过按钮已禁用，下周重置。
            </div>
          ) : null}
          <MarketplaceQueue
            submissions={pending}
            capReached={capReached}
            weeklyCap={MARKETPLACE_WEEKLY_CAP}
          />
        </>
      ) : decided.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          没有{tab === "approved" ? "已通过" : "已拒绝"}的投稿
        </p>
      ) : (
        <div className="space-y-3">
          {decided.map((s) => (
            <div key={s.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    活动日期 {fmt(s.date)} · 处理于 {fmt(s.decided_at)}
                  </p>
                  {tab === "rejected" && s.reject_reason ? (
                    <p className="text-sm text-muted-foreground">
                      拒绝原因：{s.reject_reason}
                    </p>
                  ) : null}
                </div>
                {tab === "approved" && s.approved_event_id ? (
                  <Link
                    href={`/admin/events/${s.approved_event_id}`}
                    className="shrink-0 text-xs text-muted-foreground hover:underline"
                  >
                    查看活动 →
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
