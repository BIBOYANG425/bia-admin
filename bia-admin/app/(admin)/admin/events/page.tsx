import Link from "next/link";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

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

export default async function AdminEventsPage() {
  await requireRole("viewer");

  const admin = createBiaServiceRoleClient();
  const { data, error } = await admin
    .from("events")
    .select("id, title, date, location, source, status, capacity")
    .order("date", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) {
    throw new Error(`Failed to load events: ${error.message}`);
  }
  const events = (data ?? []) as EventRow[];

  // RSVP counts.
  const ids = events.map((e) => e.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: att } = await admin
      .from("event_attendance")
      .select("event_id")
      .eq("source", "rsvp")
      .in("event_id", ids);
    for (const a of att ?? []) {
      const k = a.event_id as string;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">活动</h1>
          <p className="text-sm text-muted-foreground">
            {events.length} 个活动 · 含 george 抓取的 USC/IG 活动
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/events/new">+ 新建活动</Link>
        </Button>
      </header>

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
                  还没有活动
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
                      {e.status}
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
    </div>
  );
}
