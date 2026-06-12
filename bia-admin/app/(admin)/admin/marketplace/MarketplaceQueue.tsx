"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
}: {
  submissions: PendingSubmission[];
  capReached: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setError(null);
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt("拒绝原因（可留空）：") ?? null;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/event-submissions/${id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "reject" ? JSON.stringify({ reason }) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "cap_reached"
            ? "本周审核已达上限（20）"
            : `操作失败：${data.error ?? res.status}`,
        );
        return;
      }
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
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {submissions.map((s) => (
        <div key={s.id} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground">
                {fmt(s.date)} · {s.location ?? "地点未填"} · {s.category ?? "未分类"}
              </p>
              {s.description ? (
                <p className="text-sm text-muted-foreground line-clamp-3">{s.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={busyId === s.id || capReached}
                title={capReached ? "本周审核已达上限" : undefined}
                onClick={() => act(s.id, "approve")}
              >
                通过
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === s.id}
                onClick={() => act(s.id, "reject")}
              >
                拒绝
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
