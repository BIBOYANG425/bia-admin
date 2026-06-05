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

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ search?: string; page?: string }>;
}

interface StudentRow {
  id: string;
  name: string | null;
  member_id: string | null;
  user_id: string | null;
  created_at: string;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  await requireRole("viewer");
  const sp = await searchParams;
  const search = (sp.search ?? "").trim();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const admin = createBiaServiceRoleClient();
  let query = admin
    .from("students")
    .select("id, name, member_id, user_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (search) {
    query = query.or(`name.ilike.%${search}%,member_id.ilike.%${search}%`);
  }

  const { data, count, error } = await query.range(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE - 1,
  );
  if (error) {
    throw new Error(`Failed to load users: ${error.message}`);
  }

  const rows = (data ?? []) as StudentRow[];
  const total = count ?? 0;

  // Join emails from auth.users (first 200 — mirrors bia-roommate behavior).
  const emails = new Map<string, string>();
  const userIds = rows.map((r) => r.user_id).filter(Boolean) as string[];
  if (userIds.length > 0) {
    const { data: authList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    for (const u of authList?.users ?? []) {
      if (u.email) emails.set(u.id, u.email);
    }
  }

  function pageHref(target: number): string {
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (target > 0) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `?${s}` : "?";
  }

  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">用户</h1>
        <p className="text-sm text-muted-foreground">{total} 个用户</p>
      </header>

      {/* Filter bar — GET form, server-rendered, no client JS */}
      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="search" className="text-xs text-muted-foreground">
            搜索
          </label>
          <Input
            id="search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder="搜 姓名 / member_id"
          />
        </div>
        <Button type="submit">筛选</Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4">姓名</TableHead>
              <TableHead className="px-4">Member</TableHead>
              <TableHead className="px-4">邮箱</TableHead>
              <TableHead className="w-32 px-4">注册</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-28 px-4 text-center text-sm text-muted-foreground"
                >
                  没有符合条件的用户
                </TableCell>
              </TableRow>
            ) : (
              rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="px-4 py-3">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="font-medium hover:underline"
                    >
                      {u.name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs">
                    {u.member_id ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate px-4 py-3 text-xs text-muted-foreground">
                    {u.user_id ? emails.get(u.user_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(u.created_at)}
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
