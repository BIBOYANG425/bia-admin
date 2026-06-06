"use client";

// Admin event detail — edit form (EventEditor) + RSVP/check-in roster.
// Auth-gated by the withRole API it calls + the (admin) layout.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EventEditor, type EventRecord } from "../EventEditor";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AttendanceRow {
  source: string;
  created_at: string;
  students: { id: string; name: string | null; member_id: string | null } | null;
}

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AdminEventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/events/${id}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "活动不存在" : "加载失败");
          return;
        }
        const data = (await res.json()) as {
          event: EventRecord;
          attendance: AttendanceRow[];
        };
        setEvent(data.event);
        setAttendance(data.attendance ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">加载中...</div>;
  }
  if (error || !event) {
    return <div className="p-8 text-sm text-rose-600">{error ?? "未找到"}</div>;
  }

  const rsvps = attendance.filter((a) => a.source === "rsvp");
  const checkins = attendance.filter((a) => a.source === "checkin");

  return (
    <div className="p-8 space-y-6">
      <Link
        href="/admin/events"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← 活动
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>

      <EventEditor event={event} eventId={id} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          报名 / 出席（{rsvps.length} 报名 · {checkins.length} 签到）
        </h2>
        {attendance.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有人报名</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">姓名</TableHead>
                  <TableHead className="px-4">Member</TableHead>
                  <TableHead className="w-24 px-4">类型</TableHead>
                  <TableHead className="w-32 px-4">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-4 py-2">
                      {a.students?.name ?? "—"}
                    </TableCell>
                    <TableCell className="px-4 py-2 font-mono text-xs">
                      {a.students?.member_id ?? "—"}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-xs">{a.source}</TableCell>
                    <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                      {fmtDate(a.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
