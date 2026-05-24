"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Code2,
  Eye,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { roleAtLeast, type Role } from "@biboyang425/bia-shared";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CoverImageInput } from "./CoverImageInput";

type ArticleStatus = "draft" | "in_review" | "published" | "unpublished";
type ArticleLanguage = "en" | "zh";

interface ArticleInitial {
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

interface ApiResponse {
  id?: string;
  article?: { id?: string };
  error?: string;
  message?: string;
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

const BLOCKED_PREVIEW_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "img",
  "svg",
  "link",
  "meta",
];

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    /^https?:\/\//i.test(trimmed) ||
    /^mailto:/i.test(trimmed) ||
    /^tel:/i.test(trimmed)
  );
}

function sanitizePreviewHtml(source: string): string {
  if (!source.trim()) return "";

  const doc = new DOMParser().parseFromString(source, "text/html");
  doc
    .querySelectorAll(BLOCKED_PREVIEW_TAGS.join(","))
    .forEach((node) => node.remove());

  doc.body.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcdoc") {
        element.removeAttribute(attribute.name);
        return;
      }
      if ((name === "href" || name === "src") && !isSafeUrl(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return doc.body.innerHTML;
}

function getErrorMessage(payload: ApiResponse, fallback: string): string {
  return payload.error ?? payload.message ?? fallback;
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

export function BlogEditor({
  initial,
  role,
}: {
  initial?: ArticleInitial | null;
  role: Role;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [language, setLanguage] = useState<ArticleLanguage>(
    initial?.language ?? "en",
  );
  const [tagsValue, setTagsValue] = useState(
    (initial?.tags ?? []).join(", "),
  );
  const [coverUrl, setCoverUrl] = useState<string | null>(
    initial?.cover_image_url ?? null,
  );
  const [html, setHtml] = useState(initial?.html_clean ?? "");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const id = initial?.id;
  const status = initial?.status ?? "draft";
  const canEdit = roleAtLeast(role, "editor");
  const canSupervise = role === "super_admin";
  const canSave = canEdit && (status !== "published" || canSupervise);
  const canSubmit = Boolean(id && status === "draft" && canEdit);
  const canReject = Boolean(id && status === "in_review" && canSupervise);
  const canPublish = Boolean(
    id && (status === "in_review" || status === "unpublished") && canSupervise,
  );
  const canUnpublish = Boolean(id && status === "published" && canSupervise);
  const canDelete = Boolean(id && canSupervise && status !== "published");
  const [previewHtml, setPreviewHtml] = useState("");

  useEffect(() => {
    setPreviewHtml(sanitizePreviewHtml(html));
  }, [html]);

  async function saveDraft() {
    if (!canSave) return;
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }
    if (!html.trim()) {
      toast.error("Article HTML is required.");
      return;
    }

    setPendingAction("save");
    try {
      const res = await fetch(id ? `/api/admin/articles/${id}` : "/api/admin/articles", {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          html,
          language,
          tags: parseTags(tagsValue),
          cover_image_url: coverUrl,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as ApiResponse;

      if (!res.ok) {
        throw new Error(getErrorMessage(payload, "save_failed"));
      }

      toast.success(id ? "Article saved" : "Draft created");
      const nextId = payload.id ?? payload.article?.id;
      if (!id && nextId) {
        router.push(`/admin/blog/${nextId}`);
        return;
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function runTransition(endpoint: string, successMessage: string) {
    if (!id) return;

    setPendingAction(endpoint);
    try {
      const res = await fetch(`/api/admin/articles/${id}/${endpoint}`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => ({}))) as ApiResponse;

      if (!res.ok) {
        throw new Error(getErrorMessage(payload, `${endpoint}_failed`));
      }

      toast.success(successMessage);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteArticle() {
    if (!id || !canDelete) return;

    setPendingAction("delete");
    try {
      const res = await fetch(`/api/admin/articles/${id}`, {
        method: "DELETE",
      });
      const payload = (await res.json().catch(() => ({}))) as ApiResponse;

      if (!res.ok) {
        throw new Error(getErrorMessage(payload, "delete_failed"));
      }

      toast.success("Article deleted");
      router.push("/admin/blog");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  const saving = pendingAction === "save";
  const busy = pendingAction !== null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_180px_220px]">
          <div className="space-y-2">
            <Label htmlFor="article-title">Title</Label>
            <Input
              id="article-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Article title"
              disabled={!canSave || busy}
            />
            {initial?.slug && (
              <p className="truncate text-xs text-muted-foreground">
                /{initial.slug}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="article-language">Language</Label>
            <Select
              value={language}
              onValueChange={(value) => setLanguage(value as ArticleLanguage)}
              disabled={!canSave || busy}
            >
              <SelectTrigger id="article-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">Chinese</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <div className="flex h-9 items-center">
              <StatusPill status={status} />
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
          <div className="space-y-2">
            <Label htmlFor="article-tags">Tags</Label>
            <Input
              id="article-tags"
              value={tagsValue}
              onChange={(event) => setTagsValue(event.target.value)}
              placeholder="career, ai, usc"
              disabled={!canSave || busy}
            />
            <p className="text-xs text-muted-foreground">
              Separate tags with commas.
            </p>
          </div>
          <CoverImageInput
            value={coverUrl}
            onChange={setCoverUrl}
            disabled={!canSave || busy}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="article-html">Source HTML</Label>
          </div>
          <textarea
            id="article-html"
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            placeholder="Paste article HTML here."
            disabled={!canSave || busy}
            className="min-h-[420px] w-full resize-y rounded-lg border bg-white p-3 font-mono text-sm leading-6 shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring xl:h-[58vh] xl:min-h-[560px]"
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <Label>Preview</Label>
          </div>
          {previewHtml ? (
            <div
              className="min-h-[420px] overflow-auto rounded-lg border bg-white p-5 text-sm leading-7 text-zinc-800 shadow-sm xl:h-[58vh] xl:min-h-[560px] [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:mb-4 [&_strong]:font-semibold [&_ul]:mb-4"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <div className="min-h-[420px] overflow-auto rounded-lg border bg-white p-5 text-sm leading-7 text-zinc-800 shadow-sm xl:h-[58vh] xl:min-h-[560px]">
              <p className="text-muted-foreground">Preview appears here.</p>
            </div>
          )}
        </section>
      </div>

      <div className="sticky bottom-0 z-10 -mx-8 border-t bg-zinc-50/95 px-8 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={saveDraft} disabled={!canSave || busy}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {id ? "Save changes" : "Save draft"}
          </Button>

          {canSubmit && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void runTransition("submit", "Submitted for review")}
              disabled={busy}
            >
              <Send className="h-4 w-4" />
              Submit
            </Button>
          )}

          {canPublish && (
            <Button
              type="button"
              onClick={() =>
                void runTransition(
                  "publish",
                  status === "unpublished" ? "Article republished" : "Article published",
                )
              }
              disabled={busy}
            >
              <CheckCircle2 className="h-4 w-4" />
              {status === "unpublished" ? "Republish" : "Publish"}
            </Button>
          )}

          {canReject && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void runTransition("reject", "Article rejected")}
              disabled={busy}
            >
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
          )}

          {canUnpublish && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void runTransition("unpublish", "Article unpublished")}
              disabled={busy}
            >
              <RotateCcw className="h-4 w-4" />
              Unpublish
            </Button>
          )}

          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this article?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the article permanently from the admin system.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void deleteArticle()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <div className="ml-auto text-xs text-muted-foreground">
            {busy ? "Working..." : "Changes save through the article API."}
          </div>
        </div>
      </div>
    </div>
  );
}
