"use client";

// WS6 Squad moderation actions (editor+). Cancel = set cancelled_at (status
// flips to '已取消'); reopen = clear cancelled_at. There is no separate
// hidden/removed flag in the schema, so cancellation is the moderation lever
// for taking a violating 局 down. Writes go through
// POST /api/admin/squad/[id]/cancel | /reopen (withRole('editor') + writeAudit).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useCanWrite } from "@/lib/auth/role-context";

export function SquadModeration({
  postId,
  cancelled,
  statusLabel,
}: {
  postId: string;
  cancelled: boolean;
  statusLabel: string;
}) {
  const canWrite = useCanWrite();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  const act = async (action: "cancel" | "reopen") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/squad/${postId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "cancel" && reason.trim() ? { reason: reason.trim() } : {},
        ),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? "操作失败");
        return;
      }
      toast.success(action === "cancel" ? "已取消该局" : "已重新开启");
      setReason("");
      router.refresh();
    } catch {
      toast.error("操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="p-4">
        <CardTitle className="text-base">审核操作</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {!canWrite ? (
          <p className="text-xs text-muted-foreground">只读：无法执行审核操作</p>
        ) : cancelled ? (
          <>
            <p className="text-xs text-muted-foreground">
              该局已取消（状态「{statusLabel}」）。如为误操作，可重新开启。
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => act("reopen")}
              disabled={busy}
            >
              {busy ? "处理中…" : "重新开启"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              取消会把该局从招募中下架（设置 cancelled_at，状态变为「已取消」）。
              用于处理违规或不当内容。
            </p>
            <div className="space-y-1">
              <label htmlFor="reason" className="text-xs text-muted-foreground">
                原因（可选，写入审计日志）
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="如：垃圾信息 / 不当内容 / 重复发布"
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={busy}>
                  取消该局
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认取消该局？</AlertDialogTitle>
                  <AlertDialogDescription>
                    该局将立即从招募中下架，状态变为「已取消」。此操作会记入审计日志。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>返回</AlertDialogCancel>
                  <AlertDialogAction onClick={() => act("cancel")}>
                    确认取消
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}
