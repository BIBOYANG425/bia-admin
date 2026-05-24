import Link from "next/link";
import { Plus } from "lucide-react";
import {
  createBiaServiceRoleClient,
  roleAtLeast,
} from "@biboyang425/bia-shared";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

type ArticleStatus = "draft" | "in_review" | "published" | "unpublished";

interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  language: "en" | "zh";
  status: ArticleStatus;
  updated_at: string;
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

export default async function BlogListPage() {
  const { role } = await requireRole("viewer");
  const canCreate = roleAtLeast(role, "editor");
  const supa = createBiaServiceRoleClient();

  const { data, error } = await supa
    .from("articles")
    .select("id, title, slug, language, status, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load articles: ${error.message}`);
  }

  const articles = (data ?? []) as ArticleRow[];
  const counts = articles.reduce<Record<ArticleStatus, number>>(
    (acc, article) => {
      acc[article.status] += 1;
      return acc;
    },
    { draft: 0, in_review: 0, published: 0, unpublished: 0 },
  );

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUS_ORDER.map((status) => (
          <Card key={status} className="rounded-lg shadow-sm">
            <CardHeader className="p-4 pb-2">
              <CardDescription>{STATUS_LABELS[status]}</CardDescription>
              <CardTitle className="text-2xl">{counts[status]}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="rounded-lg shadow-sm">
        <CardHeader className="p-4">
          <CardTitle className="text-base">Articles</CardTitle>
          <CardDescription>
            {articles.length} {articles.length === 1 ? "article" : "articles"}{" "}
            across all statuses.
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
                    No articles yet.
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
    </div>
  );
}
