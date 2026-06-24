import Link from "next/link";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth/require-role";
import { sanitizeSearchTerm } from "@/lib/shipping/search-filter";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface EventRow {
  id: string;
  title: string;
  date: string | null;
  location: string | null;
  source: string;
  status: string;
  capacity: number | null;
}

const SOURCE_LABEL: Record<string, string> = {
  bia: "BIA",
  usc: "USC",
  instagram: "IG",
  community: "社区",
};
const SOURCES = ["bia", "usc", "instagram", "community"] as const;

const STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  cancelled: "已取消",
  past: "已结束",
};
const STATUSES = ["active", "cancelled", "past"] as const;
const STATUS_SET = new Set<string>(STATUSES);
const SOURCE_SET = new Set<string>(SOURCES);

const STATUS_TONE: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-100 text-emerald-800",
  cancelled: "border-rose-200 bg-rose-100 text-rose-800",
  past: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

interface PageProps {
  searchParams: Promise<{
    status?: string;
    source?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function AdminEventsPage({ searchParams }: PageProps) {
  await requireRole("viewer");
  const sp = await searchParams;
  const status = sp.status && STATUS_SET.has(sp.status) ? sp.status : "";
  const source = sp.source && SOURCE_SET.has(sp.source) ? sp.source : "";
  const search = (sp.search ?? "").trim();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const admin = createBiaServiceRoleClient();
  let query = admin
    .from("events")
    .select("id, title, date, location, source, status, capacity", {
      count: "exact",
    })
    .order("date", { ascending: false, nullsFirst: false });

  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  const q = sanitizeSearchTerm(search);
  if (q) query = query.ilike("title", `%${q}%`);

  const { data, count, error } = await query.range(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE - 1,
  );
  if (error) {
    throw new Error(`Failed to load events: ${error.message}`);
  }
  const events = (data ?? []) as EventRow[];
  const total = count ?? 0;

  // Registered count = anyone who RSVP'd OR was checked in (check-in overwrites
  // source rsvp→checkin, so counting only 'rsvp' would drop attendees). Keeps
  // 报名 monotonic without a schema change.
  const ids = events.map((e) => e.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: att } = await admin
      .from("event_attendance")
      .select("event_id")
      .in("source", ["rsvp", "checkin"])
      .in("event_id", ids);
    for (const a of att ?? []) {
      const k = a.event_id as string;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  function pageHref(target: number): string {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (source) qs.set("source", source);
    if (search) qs.set("search", search);
    if (target > 0) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `?${s}` : "?";
  }
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">活动</h1>
          <p className="text-sm text-muted-foreground">
            {total} 个活动 · 含 george 抓取的 USC/IG 活动
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/events/new">+ 新建活动</Link>
        </Button>
      </header>

      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">
            状态
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm sm:w-36"
          >
            <option value="">全部状态</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="source" className="text-xs text-muted-foreground">
            来源
          </label>
          <select
            id="source"
            name="source"
            defaultValue={source}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm sm:w-32"
          >
            <option value="">全部来源</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="search" className="text-xs text-muted-foreground">
            搜索
          </label>
          <Input
            id="search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder="搜活动标题"
          />
        </div>
        <Button type="submit">筛选</Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4">标题</TableHead>
              <TableHead className="w-36 px-4">时间</TableHead>
              <TableHead className="px-4">地点</TableHead>
              <TableHead className="w-20 px-4">来源</TableHead>
              <TableHead className="w-24 px-4">状态</TableHead>
              <TableHead className="w-20 px-4">报名</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-28 px-4 text-center text-sm text-muted-foreground"
                >
                  没有符合条件的活动
                </TableCell>
              </TableRow>
            ) : (
              events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="px-4 py-3">
                    <Link
                      href={`/admin/events/${e.id}`}
                      className="font-medium hover:underline"
                    >
                      {e.title}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                    {fmtDate(e.date)}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate px-4 py-3 text-sm">
                    {e.location ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs">
                    {SOURCE_LABEL[e.source] ?? e.source}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        STATUS_TONE[e.status] ?? STATUS_TONE.past
                      }`}
                    >
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm tabular-nums">
                    {counts.get(e.id) ?? 0}
                    {e.capacity ? ` / ${e.capacity}` : ""}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center gap-2">
          {hasPrev ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page - 1)}>← 上一页</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              ← 上一页
            </Button>
          )}
          {hasNext ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page + 1)}>下一页 →</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              下一页 →
            </Button>
          )}
          <span className="ml-2 text-xs text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} /{" "}
            {total}
          </span>
        </div>
      )}
    </div>
  );
}
