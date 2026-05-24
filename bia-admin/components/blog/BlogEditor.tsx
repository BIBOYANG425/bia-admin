"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Code2,
  Eye,
  FileUp,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { roleAtLeast, type Role } from "@biboyang425/bia-shared";
import { ArticleRenderer } from "@biboyang425/bia-shared/articles";
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
import { MissingImagesPanel } from "./MissingImagesPanel";

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
  rejected_at?: string | null;
  rejection_reason?: string | null;
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

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

// Heuristic: if more than 20% of letters in the visible text are CJK
// Unified Ideographs, classify as Chinese. Title characters count too,
// so dropped Chinese articles flip the language automatically.
function detectLanguage(text: string): "en" | "zh" {
  let cjk = 0;
  let letters = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjk += 1;
      letters += 1;
    } else if (/\p{L}/u.test(ch)) {
      letters += 1;
    }
  }
  if (letters === 0) return "en";
  return cjk / letters > 0.2 ? "zh" : "en";
}

// Pull a sensible title from dropped HTML: prefer the <title>, then the
// first <h1>, then the first <h2>. Returns null if none look usable.
function extractTitleFromHtml(html: string): string | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const candidates = [
    doc.querySelector("title")?.textContent,
    doc.querySelector("h1")?.textContent,
    doc.querySelector("h2")?.textContent,
  ];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (trimmed) return trimmed.slice(0, 200);
  }
  return null;
}

// Strip tags client-side so we can sample text for language detection.
function htmlToPlainText(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
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
  const [htmlDragOver, setHtmlDragOver] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

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

  async function runTransition(
    endpoint: string,
    successMessage: string,
    body?: Record<string, unknown>,
  ) {
    if (!id) return;

    setPendingAction(endpoint);
    try {
      const init: RequestInit = { method: "POST" };
      if (body) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const res = await fetch(`/api/admin/articles/${id}/${endpoint}`, init);
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

  // Files dropped on the source pane: read as text and replace the editor body.
  // The sanitize pipeline strips dangerous content on save, so any text-shaped
  // file (HTML, plain text, markdown) is safe to accept here.
  const HTML_DROP_MAX_BYTES = 500_000; // 500 KB
  async function ingestHtmlFile(file: File) {
    if (file.size > HTML_DROP_MAX_BYTES) {
      toast.error("File too large (max 500 KB).");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        toast.error(`${file.name} is empty.`);
        return;
      }
      setHtml(text);

      // Auto-fill metadata where it's still empty. Never overwrite something
      // the user already typed.
      const extras: string[] = [];
      if (!title.trim()) {
        const detected = extractTitleFromHtml(text);
        if (detected) {
          setTitle(detected);
          extras.push(`title "${detected}"`);
        }
      }
      // Always re-detect language from content (cheap, and the user can flip
      // back via the dropdown if they disagree).
      const plain = htmlToPlainText(text);
      const sample = `${title} ${plain}`.slice(0, 4000);
      const lang = detectLanguage(sample);
      if (lang !== language) {
        setLanguage(lang);
        extras.push(`language ${lang === "zh" ? "中文" : "English"}`);
      }

      const tail = extras.length ? ` · ${extras.join(", ")}` : "";
      toast.success(`Loaded ${file.name}${tail}`);
    } catch {
      toast.error("Could not read file.");
    }
  }

  function isFileDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleHtmlDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event) || !canSave || busy) return;
    event.preventDefault();
    setHtmlDragOver(true);
  }

  function handleHtmlDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event) || !canSave || busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleHtmlDragLeave(event: React.DragEvent<HTMLDivElement>) {
    // Only clear state when leaving the wrapper, not nested children.
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setHtmlDragOver(false);
  }

  function handleHtmlDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setHtmlDragOver(false);
    if (!canSave || busy) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void ingestHtmlFile(file);
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

      {initial?.rejected_at && status === "draft" && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <div className="flex items-start gap-2">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <div className="text-sm text-rose-900">
              <p className="font-medium">
                Sent back to draft
                <span className="ml-2 text-xs font-normal text-rose-700">
                  {new Date(initial.rejected_at).toLocaleString()}
                </span>
              </p>
              {initial.rejection_reason ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-rose-800">
                  {initial.rejection_reason}
                </p>
              ) : (
                <p className="mt-1 text-xs text-rose-700">
                  No note was left.
                </p>
              )}
              <p className="mt-2 text-xs text-rose-700">
                This note clears when you resubmit for review.
              </p>
            </div>
          </div>
        </div>
      )}

      <MissingImagesPanel
        html={html}
        onChange={setHtml}
        disabled={!canSave || busy}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="article-html">Source HTML</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste or drop an .html file
            </p>
          </div>
          <div
            onDragEnter={handleHtmlDragEnter}
            onDragOver={handleHtmlDragOver}
            onDragLeave={handleHtmlDragLeave}
            onDrop={handleHtmlDrop}
            className="relative"
          >
            <textarea
              id="article-html"
              value={html}
              onChange={(event) => setHtml(event.target.value)}
              placeholder="Paste article HTML here, or drop a file."
              disabled={!canSave || busy}
              className="min-h-[420px] w-full resize-y rounded-lg border bg-white p-3 font-mono text-sm leading-6 shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring xl:h-[58vh] xl:min-h-[560px]"
            />
            {htmlDragOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-emerald-400 bg-emerald-50/90 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2 text-emerald-800">
                  <FileUp className="h-7 w-7" />
                  <p className="text-sm font-medium">Drop to load file</p>
                  <p className="text-xs text-emerald-700">
                    HTML, text, or markdown — up to 500 KB
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <Label>Preview</Label>
          </div>
          {html.trim() ? (
            <div className="overflow-auto rounded-lg border bg-white shadow-sm xl:h-[58vh] xl:min-h-[560px]">
              {/* Same iframe renderer the public /blog/[slug] page uses — */}
              {/* what you see here matches what readers will see after publish. */}
              <ArticleRenderer html={html} className="w-full border-0 bg-white" />
            </div>
          ) : (
            <div className="min-h-[420px] overflow-auto rounded-lg border bg-white p-6 shadow-sm xl:h-[58vh] xl:min-h-[560px]">
              <p className="text-sm text-muted-foreground">Preview appears here.</p>
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
            <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  <XCircle className="h-4 w-4" />
                  Reject
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reject this article?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This sends the article back to draft. Leave a note so the
                    author knows what needs to change. The note is recorded in
                    the audit log.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="What needs to change before this can publish?"
                  rows={4}
                  disabled={busy}
                  className="w-full resize-y rounded-md border bg-background p-3 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      const reason = rejectReason.trim();
                      void runTransition(
                        "reject",
                        "Article rejected",
                        reason ? { reason } : undefined,
                      );
                      setRejectReason("");
                      setRejectOpen(false);
                    }}
                    disabled={busy}
                  >
                    Send rejection
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
