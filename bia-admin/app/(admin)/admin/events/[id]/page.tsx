"use client";

// Admin event detail — edit form (EventEditor) + RSVP/check-in roster with
// per-attendee check-in toggle and a member_id walk-in box. rsvp→checkin flips
// the row's source via /api/admin/events/[id]/checkin. Auth-gated by the API.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { roleAtLeast } from "@biboyang425/bia-shared";
import { useRole } from "@/lib/auth/role-context";
import { EventEditor, type EventRecord } from "../EventEditor";
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
  const router = useRouter();
  const role = useRole();
  const canWrite = roleAtLeast(role, "editor");
  const canDelete = roleAtLeast(role, "super_admin");
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/events/${id}`, { cache: "no-store" });
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
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function checkin(opts: {
    student_id?: string;
    member_id?: string;
    checked_in: boolean;
  }) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${id}/checkin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "操作失败");
      }
      await load();
    } catch (e) {
      toast.error(
        (e as Error).message === "student_not_found"
          ? "没找到该 member_id"
          : "操作失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("删除这个活动？将同时移除其报名/签到记录，不可撤销。"))
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/events/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "删除失败");
        return;
      }
      toast.success("已删除");
      router.push("/admin/events");
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !event) {
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
        {canDelete && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? "删除中…" : "删除活动"}
          </Button>
        )}
      </div>

      <EventEditor event={event} eventId={id} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            报名 / 出席（{rsvps.length} 报名 · {checkins.length} 签到）
          </h2>
          {attendance.length > 0 && (
            <a
              href={`/api/admin/events/${id}/export`}
              className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-muted"
            >
              导出 CSV
            </a>
          )}
        </div>

        {canWrite && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                按 member_id 签到（现场 walk-in）
              </label>
              <Input
                value={walkIn}
                onChange={(e) => setWalkIn(e.target.value)}
                placeholder="BIA-XXXXXX"
                className="w-48"
              />
            </div>
            <Button
              type="button"
              disabled={busy || !walkIn.trim()}
              onClick={async () => {
                await checkin({ member_id: walkIn.trim(), checked_in: true });
                setWalkIn("");
              }}
            >
              签到
            </Button>
          </div>
        )}

        {attendance.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有人报名</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">姓名</TableHead>
                  <TableHead className="px-4">Member</TableHead>
                  <TableHead className="w-24 px-4">状态</TableHead>
                  <TableHead className="w-32 px-4">时间</TableHead>
                  <TableHead className="w-28 px-4">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.map((a) => {
                  const sid = a.students?.id;
                  const checkedIn = a.source === "checkin";
                  return (
                    <TableRow key={sid ?? a.created_at}>
                      <TableCell className="px-4 py-2">
                        {a.students?.name ?? "—"}
                      </TableCell>
                      <TableCell className="px-4 py-2 font-mono text-xs">
                        {a.students?.member_id ?? "—"}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-xs">
                        {checkedIn ? "已签到" : "报名"}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                        {fmtDate(a.created_at)}
                      </TableCell>
                      <TableCell className="px-4 py-2">
                        {sid && canWrite && (
                          <Button
                            type="button"
                            size="sm"
                            variant={checkedIn ? "outline" : "default"}
                            disabled={busy}
                            onClick={() =>
                              checkin({ student_id: sid, checked_in: !checkedIn })
                            }
                          >
                            {checkedIn ? "撤销" : "签到"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
