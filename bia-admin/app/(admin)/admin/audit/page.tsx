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
import { AUDIT_ENTITY_TYPES } from "@/lib/admin/audit-log";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{
    entity_type?: string;
    action?: string;
    admin_email?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

interface AuditRow {
  id: string;
  admin_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const ENTITY_SET = new Set<string>(AUDIT_ENTITY_TYPES);

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function summarizePayload(payload: Record<string, unknown> | null): string {
  if (!payload || Object.keys(payload).length === 0) return "—";
  try {
    return JSON.stringify(payload);
  } catch {
    return "—";
  }
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireRole("viewer");
  const sp = await searchParams;

  const entityType =
    sp.entity_type && ENTITY_SET.has(sp.entity_type) ? sp.entity_type : "";
  const action = (sp.action ?? "").trim();
  const adminEmail = (sp.admin_email ?? "").trim();
  const from = (sp.from ?? "").trim();
  const to = (sp.to ?? "").trim();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const admin = createBiaServiceRoleClient();
  let query = admin
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (entityType) query = query.eq("entity_type", entityType);
  if (action) query = query.ilike("action", `%${action}%`);
  if (adminEmail) query = query.ilike("admin_email", `%${adminEmail}%`);
  // Date inputs are YYYY-MM-DD; make `to` inclusive of the whole day.
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

  const { data, count, error } = await query.range(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE - 1,
  );
  if (error) {
    throw new Error(`Failed to load audit log: ${error.message}`);
  }

  const rows = (data ?? []) as AuditRow[];
  const total = count ?? 0;

  function pageHref(target: number): string {
    const qs = new URLSearchParams();
    if (entityType) qs.set("entity_type", entityType);
    if (action) qs.set("action", action);
    if (adminEmail) qs.set("admin_email", adminEmail);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (target > 0) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `?${s}` : "?";
  }

  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">审计日志</h1>
        <p className="text-sm text-muted-foreground">
          {total} 条记录 · 每个改动操作都会留痕
        </p>
      </header>

      {/* Filter bar — GET form, server-rendered, no client JS */}
      <form
        method="get"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="entity_type" className="text-xs text-muted-foreground">
            实体类型
          </label>
          <select
            id="entity_type"
            name="entity_type"
            defaultValue={entityType}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="">全部类型</option>
            {AUDIT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="action" className="text-xs text-muted-foreground">
            操作
          </label>
          <Input
            id="action"
            name="action"
            type="search"
            defaultValue={action}
            placeholder="如 parcel.update"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="admin_email" className="text-xs text-muted-foreground">
            操作人
          </label>
          <Input
            id="admin_email"
            name="admin_email"
            type="search"
            defaultValue={adminEmail}
            placeholder="officer@…"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs text-muted-foreground">
            起始日期
          </label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs text-muted-foreground">
            结束日期
          </label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit">筛选</Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-44 px-4">时间</TableHead>
              <TableHead className="px-4">操作人</TableHead>
              <TableHead className="px-4">操作</TableHead>
              <TableHead className="px-4">实体</TableHead>
              <TableHead className="px-4">详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-28 px-4 text-center text-sm text-muted-foreground"
                >
                  没有符合条件的审计记录
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(r.created_at)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate px-4 py-3 text-xs">
                    {r.admin_email}
                  </TableCell>
                  <TableCell className="px-4 py-3 font-mono text-xs">
                    {r.action}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs">
                    <span className="text-muted-foreground">{r.entity_type}</span>
                    {r.entity_id ? (
                      <span className="ml-1 font-mono">{r.entity_id}</span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="max-w-[320px] truncate px-4 py-3 font-mono text-xs text-muted-foreground"
                    title={summarizePayload(r.payload)}
                  >
                    {summarizePayload(r.payload)}
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
