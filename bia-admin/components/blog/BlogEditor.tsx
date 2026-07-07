"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, XCircle } from "lucide-react";
import { roleAtLeast, type Role } from "@biboyang425/bia-shared";
import { ArticleRenderer } from "@biboyang425/bia-shared/react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ArticleLanguage } from "@/lib/blog/html-drop";
import { CoverImageInput } from "./CoverImageInput";
import { EditorActionBar } from "./EditorActionBar";
import { HtmlDropZone } from "./HtmlDropZone";
import { MissingImagesPanel } from "./MissingImagesPanel";
import { ScheduleField } from "./ScheduleField";
import { StatusPill, type ArticleStatus } from "./status";

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
  scheduled_publish_at?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  rejection_reason?: string | null;
}

interface ApiResponse {
  id?: string;
  article?: { id?: string };
  error?: string;
  message?: string;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function getErrorMessage(payload: ApiResponse, fallback: string): string {
  return payload.error ?? payload.message ?? fallback;
}

// <input type="datetime-local"> works in local time without a zone. Convert an
// ISO timestamp to the "YYYY-MM-DDTHH:mm" the input expects, anchored to the
// browser's local zone.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Convert a datetime-local value (local time, no zone) back to a UTC ISO string
// the API stores. Returns null for an empty input.
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function BlogEditor({
  initial,
  role,
  rejectedByName = null,
}: {
  initial?: ArticleInitial | null;
  role: Role;
  rejectedByName?: string | null;
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
  const [scheduledAt, setScheduledAt] = useState(
    isoToLocalInput(initial?.scheduled_publish_at),
  );
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

  const saving = pendingAction === "save";
  const busy = pendingAction !== null;
  // Scheduling makes sense for not-yet-published articles. Once published the
  // manual flow already governs visibility, so the input is hidden.
  const canSchedule = Boolean(
    id && canEdit && (status === "draft" || status === "in_review"),
  );

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

  // Persist (or clear) the publish schedule independently of the body save, so
  // an officer can schedule without re-touching content. PATCHes only the
  // scheduled_publish_at field.
  async function saveSchedule(nextValue: string) {
    if (!id || !canSchedule) return;
    const iso = localInputToIso(nextValue);

    setPendingAction("schedule");
    try {
      const res = await fetch(`/api/admin/articles/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduled_publish_at: iso }),
      });
      const payload = (await res.json().catch(() => ({}))) as ApiResponse;

      if (!res.ok) {
        throw new Error(getErrorMessage(payload, "schedule_failed"));
      }

      toast.success(iso ? "Publish scheduled" : "Schedule cleared");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

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
                {rejectedByName ? `Sent back by ${rejectedByName}` : "Sent back to draft"}
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

      {canSchedule && (
        <ScheduleField
          value={scheduledAt}
          onChange={setScheduledAt}
          busy={busy}
          saving={pendingAction === "schedule"}
          currentIso={initial?.scheduled_publish_at ?? null}
          onSave={(next) => void saveSchedule(next)}
          onClear={() => {
            setScheduledAt("");
            void saveSchedule("");
          }}
        />
      )}

      <MissingImagesPanel
        html={html}
        onChange={setHtml}
        disabled={!canSave || busy}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <HtmlDropZone
          html={html}
          onHtmlChange={setHtml}
          title={title}
          onTitleChange={setTitle}
          language={language}
          onLanguageChange={setLanguage}
          disabled={!canSave || busy}
        />

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

      <EditorActionBar
        id={id}
        status={status}
        saving={saving}
        busy={busy}
        canSave={canSave}
        canSubmit={canSubmit}
        canPublish={canPublish}
        canReject={canReject}
        canUnpublish={canUnpublish}
        canDelete={canDelete}
        onSave={() => void saveDraft()}
        onTransition={(endpoint, successMessage, body) =>
          void runTransition(endpoint, successMessage, body)
        }
        onDelete={() => void deleteArticle()}
      />
    </div>
  );
}
