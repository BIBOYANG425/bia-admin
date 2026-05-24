import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import { BlogEditor } from "@/components/blog/BlogEditor";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

// Same formatter as the blog list page so date display stays consistent.
function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

type ArticleStatus = "draft" | "in_review" | "published" | "unpublished";
type ArticleLanguage = "en" | "zh";

interface Article {
  id: string;
  title: string;
  slug: string;
  html_clean: string;
  language: ArticleLanguage;
  status: ArticleStatus;
  tags: string[];
  cover_image_url: string | null;
  updated_at?: string;
}

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { role } = await requireRole("editor");
  const { id } = await params;
  const supa = createBiaServiceRoleClient();

  const { data, error } = await supa
    .from("articles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load article: ${error.message}`);
  }
  if (!data) {
    notFound();
  }

  const article = data as Article;

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="w-fit px-0">
          <Link href="/admin/blog">
            <ArrowLeft className="h-4 w-4" />
            Blog
          </Link>
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Edit article
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              /{article.slug}
            </p>
          </div>
          {article.updated_at && (
            <p className="text-xs text-muted-foreground">
              Updated {formatUpdatedAt(article.updated_at)}
            </p>
          )}
        </div>
      </header>

      <BlogEditor role={role} initial={article} />
    </div>
  );
}
