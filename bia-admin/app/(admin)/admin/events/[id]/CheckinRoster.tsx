"use client";

// Client roster island for the event detail page. Renders the RSVP/check-in
// table plus the member_id walk-in box. Each check-in (or undo) POSTs to
// /api/admin/events/[id]/checkin and then calls router.refresh() to re-pull
// the server-rendered attendance — the same refresh the old load() re-fetch
// gave. Attendance data comes in from the parent server component.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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

export interface AttendanceRow {
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

export function CheckinRoster({
  eventId,
  attendance,
  canWrite,
}: {
  eventId: string;
  attendance: AttendanceRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [walkIn, setWalkIn] = useState("");
  const [busy, setBusy] = useState(false);

  async function checkin(opts: {
    student_id?: string;
    member_id?: string;
    checked_in: boolean;
  }) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/checkin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "操作失败");
      }
      router.refresh();
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

  const rsvps = attendance.filter((a) => a.source === "rsvp");
  const checkins = attendance.filter((a) => a.source === "checkin");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          报名 / 出席（{rsvps.length} 报名 · {checkins.length} 签到）
        </h2>
        {attendance.length > 0 && (
          <a
            href={`/api/admin/events/${eventId}/export`}
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
  );
}
