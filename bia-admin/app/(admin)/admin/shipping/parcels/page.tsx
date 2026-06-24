import Link from "next/link";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { roleAtLeast } from "@biboyang425/bia-shared";
import {
  PARCEL_STATUS_META,
  PARCEL_STATUS_VALUES,
  SHIPPING_METHOD_META,
  type Parcel,
  type ParcelStatus,
} from "@biboyang425/bia-shared/shipping";

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
import { ParcelStatusPill } from "@/components/shipping/ParcelStatusPill";
import { requireRole } from "@/lib/auth/require-role";
import { sanitizeSearchTerm } from "@/lib/shipping/search-filter";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUS_SET = new Set<string>(PARCEL_STATUS_VALUES);

interface PageProps {
  searchParams: Promise<{
    status?: string;
    search?: string;
    member_id?: string;
    page?: string;
  }>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function AdminParcelsPage({ searchParams }: PageProps) {
  const { role } = await requireRole("viewer");
  const canWrite = roleAtLeast(role, "editor");
  const sp = await searchParams;

  const status: ParcelStatus | "" =
    sp.status && STATUS_SET.has(sp.status) ? (sp.status as ParcelStatus) : "";
  const search = (sp.search ?? "").trim();
  const memberId = (sp.member_id ?? "").trim();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const admin = createBiaServiceRoleClient();
  let query = admin
    .from("parcels")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  // Exact member_id filter — a structured control distinct from free-text search
  // (the API route already supports member_id; this surfaces it in the UI).
  if (memberId) query = query.eq("member_id", memberId);
  // Sanitize before interpolating into the PostgREST .or() grammar (matches the
  // API route; raw input could otherwise inject filter conditions).
  const q = sanitizeSearchTerm(search);
  if (q) {
    query = query.or(
      `description.ilike.%${q}%,tracking_cn.ilike.%${q}%,member_id.ilike.%${q}%`,
    );
  }

  const { data, count, error } = await query.range(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE - 1,
  );
  if (error) {
    throw new Error(`Failed to load parcels: ${error.message}`);
  }

  const parcels = (data ?? []) as Parcel[];
  const total = count ?? 0;

  function pageHref(target: number): string {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (search) qs.set("search", search);
    if (memberId) qs.set("member_id", memberId);
    if (target > 0) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `?${s}` : "?";
  }

  // Quick "到达美国" filter affordance — preserves an active member_id filter,
  // toggles the status filter on/off.
  const arrivedUsActive = status === "arrived_us";
  function arrivedUsHref(): string {
    const qs = new URLSearchParams();
    if (!arrivedUsActive) qs.set("status", "arrived_us");
    if (memberId) qs.set("member_id", memberId);
    const s = qs.toString();
    return s ? `?${s}` : "?";
  }

  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">集运 · 包裹</h1>
          <p className="text-sm text-muted-foreground">{total} 个包裹</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant={arrivedUsActive ? "default" : "outline"}
            size="sm"
          >
            <Link href={arrivedUsHref()}>
              {arrivedUsActive ? "✓ 到达美国" : "到达美国"}
            </Link>
          </Button>
          {canWrite && (
            <Button asChild size="sm">
              <Link href="/admin/shipping/parcels/new">+ 新建包裹</Link>
            </Button>
          )}
        </div>
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
            {PARCEL_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {PARCEL_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:w-48">
          <label htmlFor="member_id" className="text-xs text-muted-foreground">
            Member ID（精确）
          </label>
          <Input
            id="member_id"
            name="member_id"
            defaultValue={memberId}
            placeholder="如 BIA-1234"
          />
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
            placeholder="搜 member_id / 描述 / 运单号"
          />
        </div>
        <Button type="submit">筛选</Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4">Member</TableHead>
              <TableHead className="px-4">Description</TableHead>
              <TableHead className="w-32 px-4">Status</TableHead>
              <TableHead className="w-36 px-4">方式</TableHead>
              <TableHead className="w-24 px-4">重量</TableHead>
              <TableHead className="w-32 px-4">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parcels.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-28 px-4 text-center text-sm text-muted-foreground"
                >
                  没有符合条件的包裹
                </TableCell>
              </TableRow>
            ) : (
              parcels.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="px-4 py-3">
                    <Link
                      href={`/admin/shipping/parcels/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.member_id}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate px-4 py-3">
                    {p.description}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <ParcelStatusPill status={p.status} size="sm" />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs">
                    {p.shipping_method
                      ? `${SHIPPING_METHOD_META[p.shipping_method].icon} ${SHIPPING_METHOD_META[p.shipping_method].label}`
                      : "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                    {p.weight_grams
                      ? `${(p.weight_grams / 1000).toFixed(1)} kg`
                      : "—"}
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
