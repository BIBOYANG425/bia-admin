import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

type ArticleStatus = "draft" | "in_review" | "published" | "unpublished";

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

interface Revision {
  id: string;
  title: string;
  body: string;
  language: "en" | "zh";
  status: ArticleStatus;
  edited_by: string | null;
  created_at: string;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function ArticleHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("viewer");
  const { id } = await params;
  const supa = createBiaServiceRoleClient();

  const { data: article, error: articleError } = await supa
    .from("articles")
    .select("id, title, slug")
    .eq("id", id)
    .maybeSingle();

  if (articleError) {
    throw new Error(`Failed to load article: ${articleError.message}`);
  }
  if (!article) {
    notFound();
  }

  const { data, error } = await supa
    .from("article_revisions")
    .select("id, title, body, language, status, edited_by, created_at")
    .eq("article_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(`Failed to load revisions: ${error.message}`);
  }

  const revisions = (data ?? []) as Revision[];

  // Resolve editor emails in one pass so each row can show who saved it.
  const editorEmails = new Map<string, string>();
  const editorIds = Array.from(
    new Set(revisions.map((r) => r.edited_by).filter(Boolean) as string[]),
  );
  if (editorIds.length > 0) {
    const { data: admins } = await supa
      .from("admin_users")
      .select("id, email")
      .in("id", editorIds);
    for (const admin of admins ?? []) {
      if (admin.email) editorEmails.set(admin.id, admin.email);
    }
  }

  function editorLabel(editedBy: string | null): string {
    if (!editedBy) return "—";
    const email = editorEmails.get(editedBy);
    if (!email) return "Unknown";
    return email.split("@")[0] || email;
  }

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="w-fit px-0">
          <Link href={`/admin/blog/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            Edit article
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Revision history</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {article.title} · /{article.slug}
          </p>
        </div>
      </header>

      {revisions.length === 0 ? (
        <Card className="rounded-lg shadow-sm">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No revisions recorded yet. A snapshot is saved each time the article
            is edited.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {revisions.map((revision, index) => (
            <Card key={revision.id} className="rounded-lg shadow-sm">
              <CardHeader className="p-4 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">
                    {revision.title}
                  </CardTitle>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[revision.status]}`}
                  >
                    {STATUS_LABELS[revision.status]}
                  </span>
                  {index === 0 && (
                    <span className="inline-flex items-center rounded-md border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      Latest
                    </span>
                  )}
                </div>
                <CardDescription>
                  {formatTimestamp(revision.created_at)} ·{" "}
                  {revision.language.toUpperCase()} ·{" "}
                  {editorLabel(revision.edited_by)}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:underline">
                    View source HTML ({revision.body.length.toLocaleString()}{" "}
                    chars)
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-md border bg-zinc-50 p-3 text-xs leading-5">
                    {revision.body}
                  </pre>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
