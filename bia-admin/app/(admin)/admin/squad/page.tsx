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
import {
  SQUAD_POST_STATUS_VALUES,
  SQUAD_STATUS_META,
  squadStatusLabel,
  squadStatusPillClass,
  type SquadPostRow,
  type SquadPostStatus,
} from "@/lib/squad/status";

// Read-first Squad moderation surface (WS6). Lists the derived-status view
// squad_posts_with_status; rows link to a detail page that shows members +
// ping outcomes and (editor+) cancel/reopen actions.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUS_SET = new Set<string>(SQUAD_POST_STATUS_VALUES);

interface PageProps {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function postTitle(p: SquadPostRow): string {
  const body = (p.content ?? "").trim();
  if (body) return body.length > 60 ? `${body.slice(0, 60)}…` : body;
  return p.category ? `[${p.category}]` : "（无内容）";
}

export default async function AdminSquadPage({ searchParams }: PageProps) {
  await requireRole("viewer");
  const sp = await searchParams;

  const status: SquadPostStatus | "" =
    sp.status && STATUS_SET.has(sp.status) ? (sp.status as SquadPostStatus) : "";
  const search = (sp.search ?? "").trim();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const admin = createBiaServiceRoleClient();
  let query = admin
    .from("squad_posts_with_status")
    .select(
      "id, category, content, location, contact, poster_name, tags, status, current_people, max_people, deadline, created_at, created_via, cancelled_at, completed_at, needs_refill, user_id, created_by_student_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  // `status` is a derived column on the view, so it can be filtered like any
  // other column.
  if (status) query = query.eq("status", status);

  // Sanitize before interpolating into the PostgREST .or() grammar (raw input
  // could otherwise inject filter conditions) — mirrors the parcels page.
  const q = sanitizeSearchTerm(search);
  if (q) {
    query = query.or(
      `content.ilike.%${q}%,category.ilike.%${q}%,location.ilike.%${q}%,poster_name.ilike.%${q}%`,
    );
  }

  const { data, count, error } = await query.range(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE - 1,
  );
  if (error) {
    throw new Error(`Failed to load squad posts: ${error.message}`);
  }

  const posts = (data ?? []) as SquadPostRow[];
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
        <h1 className="text-2xl font-bold tracking-tight">Squad · 局</h1>
        <p className="text-sm text-muted-foreground">
          {total} 个局 · 只读审核（编辑可取消违规的局）
        </p>
      </header>

      {/* Filter bar — GET form, server-rendered, no client JS */}
      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">
            状态
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm sm:w-48"
          >
            <option value="">全部状态</option>
            {SQUAD_POST_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {SQUAD_STATUS_META[s].label}
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
            placeholder="搜 内容 / 类别 / 地点 / 发起人"
          />
        </div>
        <Button type="submit">筛选</Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4">内容</TableHead>
              <TableHead className="w-28 px-4">类别</TableHead>
              <TableHead className="px-4">标签</TableHead>
              <TableHead className="w-24 px-4">状态</TableHead>
              <TableHead className="w-20 px-4">人数</TableHead>
              <TableHead className="w-32 px-4">创建</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-28 px-4 text-center text-sm text-muted-foreground"
                >
                  没有符合条件的局
                </TableCell>
              </TableRow>
            ) : (
              posts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-[280px] px-4 py-3">
                    <Link
                      href={`/admin/squad/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {postTitle(p)}
                    </Link>
                    {p.created_via === "george" && (
                      <span className="ml-2 align-middle text-[10px] text-muted-foreground">
                        george
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                    {p.category ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(p.tags ?? []).slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                      {(p.tags ?? []).length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{(p.tags ?? []).length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <span className={squadStatusPillClass(p.status)}>
                      {squadStatusLabel(p.status)}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                    {p.current_people ?? 0} / {p.max_people ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(p.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
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
