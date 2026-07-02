import Link from "next/link";
import { Plus } from "lucide-react";
import { roleAtLeast } from "@biboyang425/bia-shared";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type ArticleStatus = "draft" | "in_review" | "published" | "unpublished";

interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  language: "en" | "zh";
  status: ArticleStatus;
  updated_at: string;
}

interface PageProps {
  searchParams: Promise<{
    status?: string;
    search?: string;
    page?: string;
  }>;
}

const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  unpublished: "Unpublished",
};

const STATUS_STYLES: Record<ArticleStatus, string> = {
  draft: "border-zinc-200 bg-zinc-100 text-zinc-700",
  in_review: "border-amber-200 bg-amber-100 text-amber-800",
  published: "border-emerald-200 bg-emerald-100 text-emerald-800",
  unpublished: "border-slate-200 bg-slate-100 text-slate-700",
};

const STATUS_ORDER: ArticleStatus[] = [
  "draft",
  "in_review",
  "published",
  "unpublished",
];

function isArticleStatus(value: string): value is ArticleStatus {
  return (STATUS_ORDER as string[]).includes(value);
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function StatusPill({ status }: { status: ArticleStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export default async function BlogListPage({ searchParams }: PageProps) {
  const { role } = await requireRole("viewer");
  const canCreate = roleAtLeast(role, "editor");
  const supa = createBiaServiceRoleClient();

  const sp = await searchParams;
  const statusFilter =
    sp.status && isArticleStatus(sp.status) ? sp.status : null;
  const search = (sp.search ?? "").trim();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  // Status counts come from a lightweight head-only query per status so the
  // count cards stay accurate regardless of the active filter or page.
  const countResults = await Promise.all(
    STATUS_ORDER.map((status) =>
      supa
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("status", status),
    ),
  );
  const counts = STATUS_ORDER.reduce<Record<ArticleStatus, number>>(
    (acc, status, index) => {
      acc[status] = countResults[index].count ?? 0;
      return acc;
    },
    { draft: 0, in_review: 0, published: 0, unpublished: 0 },
  );

  // Filtered, paginated list.
  let query = supa
    .from("articles")
    .select("id, title, slug, language, status, updated_at", {
      count: "exact",
    })
    .order("updated_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }
  // Sanitize before interpolating into the PostgREST .or() grammar (matches the
  // other list pages; raw input could otherwise inject filter conditions).
  const q = sanitizeSearchTerm(search);
  if (q) {
    query = query.or(`title.ilike.%${q}%,slug.ilike.%${q}%`);
  }

  const { data, count, error } = await query.range(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE - 1,
  );

  if (error) {
    throw new Error(`Failed to load articles: ${error.message}`);
  }

  const articles = (data ?? []) as ArticleRow[];
  const total = count ?? 0;
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  // Build hrefs that preserve the active filter + search but reset to page 0
  // (status / search) or move the page (pagination).
  function buildHref(overrides: {
    status?: ArticleStatus | null;
    page?: number;
  }): string {
    const qs = new URLSearchParams();
    const nextStatus =
      overrides.status !== undefined ? overrides.status : statusFilter;
    if (nextStatus) qs.set("status", nextStatus);
    if (search) qs.set("search", search);
    const nextPage = overrides.page ?? 0;
    if (nextPage > 0) qs.set("page", String(nextPage));
    const s = qs.toString();
    return s ? `/admin/blog?${s}` : "/admin/blog";
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Blog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage article drafts, reviews, and published posts for BIA.
          </p>
        </div>
        {canCreate ? (
          <Button asChild>
            <Link href="/admin/blog/new">
              <Plus className="h-4 w-4" />
              New article
            </Link>
          </Button>
        ) : (
          <Button type="button" disabled title="Editor role required">
            <Plus className="h-4 w-4" />
            New article
          </Button>
        )}
      </header>

      {/* Status count cards double as filter toggles. Clicking the active card
          clears the filter. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUS_ORDER.map((status) => {
          const active = statusFilter === status;
          return (
            <Link
              key={status}
              href={buildHref({ status: active ? null : status })}
              aria-pressed={active}
              className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card
                className={`rounded-lg shadow-sm transition-colors hover:bg-zinc-50 ${
                  active ? "border-zinc-900 ring-1 ring-zinc-900" : ""
                }`}
              >
                <CardHeader className="p-4 pb-2">
                  <CardDescription>{STATUS_LABELS[status]}</CardDescription>
                  <CardTitle className="text-2xl">{counts[status]}</CardTitle>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Search bar — GET form, server-rendered, no client JS. Preserves the
          active status filter via a hidden field. */}
      <form
        method="get"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        {statusFilter && (
          <input type="hidden" name="status" value={statusFilter} />
        )}
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="search" className="text-xs text-muted-foreground">
            Search
          </label>
          <Input
            id="search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder="Search title or slug"
          />
        </div>
        <Button type="submit">Search</Button>
        {(search || statusFilter) && (
          <Button asChild type="button" variant="outline">
            <Link href="/admin/blog">Clear</Link>
          </Button>
        )}
      </form>

      <Card className="rounded-lg shadow-sm">
        <CardHeader className="p-4">
          <CardTitle className="text-base">Articles</CardTitle>
          <CardDescription>
            {total} {total === 1 ? "article" : "articles"}
            {statusFilter ? ` · ${STATUS_LABELS[statusFilter]}` : ""}
            {search ? ` · matching “${search}”` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">Title / slug</TableHead>
                <TableHead className="w-24 px-4">Language</TableHead>
                <TableHead className="w-36 px-4">Status</TableHead>
                <TableHead className="w-48 px-4">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-28 px-4 text-center text-sm text-muted-foreground"
                  >
                    No articles match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                articles.map((article) => (
                  <TableRow key={article.id}>
                    <TableCell className="px-4 py-3">
                      <Link
                        href={`/admin/blog/${article.id}`}
                        className="font-medium hover:underline"
                      >
                        {article.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        /{article.slug}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                      {article.language}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusPill status={article.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                      {formatUpdatedAt(article.updated_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center gap-2">
          {hasPrev ? (
            <Button asChild variant="outline" size="sm">
              <Link href={buildHref({ page: page - 1 })}>← Previous</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              ← Previous
            </Button>
          )}
          {hasNext ? (
            <Button asChild variant="outline" size="sm">
              <Link href={buildHref({ page: page + 1 })}>Next →</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next →
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
