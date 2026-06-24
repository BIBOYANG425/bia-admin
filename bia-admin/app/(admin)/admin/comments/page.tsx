import Link from "next/link";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireRole } from "@/lib/auth/require-role";
import { sanitizeSearchTerm } from "@/lib/shipping/search-filter";
import { CommentsTable, type CommentRow } from "./CommentsTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUSES = ["visible", "hidden", "deleted"] as const;
const STATUS_SET = new Set<string>(STATUSES);

interface PageProps {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>;
}

export default async function AdminCommentsPage({ searchParams }: PageProps) {
  await requireRole("viewer");
  const sp = await searchParams;
  const status = sp.status && STATUS_SET.has(sp.status) ? sp.status : "";
  const search = (sp.search ?? "").trim();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const admin = createBiaServiceRoleClient();
  let query = admin
    .from("article_comments")
    .select("*, article:articles(title, slug)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  const q = sanitizeSearchTerm(search);
  if (q) {
    query = query.or(`body.ilike.%${q}%,author_name.ilike.%${q}%`);
  }

  const { data, count, error } = await query.range(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE - 1,
  );
  if (error) {
    throw new Error(`Failed to load comments: ${error.message}`);
  }

  const rows = (data ?? []) as CommentRow[];
  const total = count ?? 0;

  function pageHref(target: number): string {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (search) qs.set("search", search);
    if (target > 0) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `?${s}` : "?";
  }

  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="space-y-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">评论管理</h1>
        <p className="text-sm text-muted-foreground">
          {total} 条评论 · 公开端默认可见，officer 在此隐藏 / 删除不当评论
        </p>
      </header>

      <form
        method="get"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">
            状态
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm sm:w-40"
          >
            <option value="">全部状态</option>
            <option value="visible">可见</option>
            <option value="hidden">已隐藏</option>
            <option value="deleted">已删除</option>
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
            placeholder="搜 评论内容 / 昵称"
          />
        </div>
        <Button type="submit">筛选</Button>
      </form>

      <CommentsTable rows={rows} />

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
