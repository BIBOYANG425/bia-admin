"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCanWrite } from "@/lib/auth/role-context";
import { Button } from "@/components/ui/button";

export interface PendingSubmission {
  id: string;
  title: string;
  description: string | null;
  date: string | null;
  location: string | null;
  category: string | null;
  created_at: string | null;
}

function fmt(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function MarketplaceQueue({
  submissions,
  capReached,
  weeklyCap,
}: {
  submissions: PendingSubmission[];
  capReached: boolean;
  weeklyCap: number;
}) {
  const router = useRouter();
  const canWrite = useCanWrite();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function approve(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/event-submissions/${id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          data.error === "cap_reached"
            ? `本周审核已达上限（${weeklyCap}）`
            : `操作失败：${data.error ?? res.status}`,
        );
        return;
      }
      toast.success("已通过");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/event-submissions/${id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(`操作失败：${data.error ?? res.status}`);
        return;
      }
      toast.success("已拒绝");
      setRejectingId(null);
      setReason("");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">没有待审核的投稿 🎉</p>;
  }

  return (
    <div className="space-y-3">
      {submissions.map((s) => (
        <div key={s.id} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground">
                {fmt(s.date)} · {s.location ?? "地点未填"} ·{" "}
                {s.category ?? "未分类"} · 投稿于 {fmt(s.created_at)}
              </p>
              {s.description ? (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {s.description}
                </p>
              ) : null}
            </div>
            {canWrite ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={busyId === s.id || capReached}
                  title={capReached ? "本周审核已达上限" : undefined}
                  onClick={() => approve(s.id)}
                >
                  通过
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === s.id}
                  onClick={() =>
                    setRejectingId(rejectingId === s.id ? null : s.id)
                  }
                >
                  拒绝
                </Button>
              </div>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">只读</span>
            )}
          </div>

          {canWrite && rejectingId === s.id ? (
            <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-3">
              <label className="text-xs text-muted-foreground">
                拒绝原因（会记录，可留空）
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="例如：与社区活动主题不符 / 信息不全"
                className="w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyId === s.id}
                  onClick={() => reject(s.id)}
                >
                  确认拒绝
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === s.id}
                  onClick={() => {
                    setRejectingId(null);
                    setReason("");
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
