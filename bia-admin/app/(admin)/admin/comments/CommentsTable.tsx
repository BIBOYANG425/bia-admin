"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useRole } from "@/lib/auth/role-context";
import { roleAtLeast } from "@biboyang425/bia-shared";
import type { ArticleComment } from "@biboyang425/bia-shared/comments";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Bound to the shared row type so the moderation table can't drift from the DB
// shape. Pick only the columns the page query selects (no moderated_at).
export interface CommentRow
  extends Pick<
    ArticleComment,
    | "id"
    | "article_id"
    | "author_name"
    | "author_member_id"
    | "body"
    | "status"
    | "created_at"
    | "moderated_by"
  > {
  article: { title: string; slug: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  visible: "可见",
  hidden: "已隐藏",
  deleted: "已删除",
};

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function CommentsTable({ rows }: { rows: CommentRow[] }) {
  const router = useRouter();
  const role = useRole();
  const canModerate = roleAtLeast(role, "editor");
  const canDelete = roleAtLeast(role, "super_admin");
  const [busyId, setBusyId] = useState<string | null>(null);

  const setStatus = async (id: string, status: CommentRow["status"]) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(e.error ?? "操作失败");
        return;
      }
      toast.success("已更新");
      router.refresh();
    } catch {
      toast.error("操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const hardDelete = async (id: string) => {
    if (!window.confirm("永久删除这条评论？此操作不可撤销。")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(e.error ?? "删除失败");
        return;
      }
      toast.success("已永久删除");
      router.refresh();
    } catch {
      toast.error("删除失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4">评论</TableHead>
            <TableHead className="w-40 px-4">文章</TableHead>
            <TableHead className="w-28 px-4">作者</TableHead>
            <TableHead className="w-24 px-4">状态</TableHead>
            <TableHead className="w-44 px-4">时间</TableHead>
            {canModerate && <TableHead className="w-56 px-4">操作</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={canModerate ? 6 : 5}
                className="h-28 px-4 text-center text-sm text-muted-foreground"
              >
                没有符合条件的评论
              </TableCell>
            </TableRow>
          ) : (
            rows.map((c) => {
              const busy = busyId === c.id;
              return (
                <TableRow key={c.id}>
                  <TableCell className="max-w-[360px] px-4 py-3 text-sm">
                    <p className="whitespace-pre-wrap break-words">{c.body}</p>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate px-4 py-3 text-xs">
                    {c.article ? (
                      <a
                        href={`https://uscbia.com/blog/${c.article.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {c.article.title}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs">
                    {c.author_name ?? "匿名"}
                    {c.author_member_id ? (
                      <span className="ml-1 font-mono text-muted-foreground">
                        {c.author_member_id}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs">
                    <span
                      className={
                        c.status === "visible"
                          ? "text-emerald-600"
                          : "text-muted-foreground"
                      }
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {fmt(c.created_at)}
                  </TableCell>
                  {canModerate && (
                    <TableCell className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {c.status === "visible" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setStatus(c.id, "hidden")}
                          >
                            隐藏
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setStatus(c.id, "visible")}
                          >
                            恢复
                          </Button>
                        )}
                        {c.status !== "deleted" && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => setStatus(c.id, "deleted")}
                          >
                            删除
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={busy}
                            onClick={() => hardDelete(c.id)}
                          >
                            永久删除
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
