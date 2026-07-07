"use client";

import Link from "next/link";
import {
  CheckCircle2,
  History,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from "lucide-react";

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
import { RejectDialog } from "./RejectDialog";
import type { ArticleStatus } from "./status";

// Sticky footer that orchestrates the article state-machine actions (save,
// submit, publish/republish, reject, unpublish, delete) plus the history link.
// Visibility of each control is decided by the parent's permission matrix.
export function EditorActionBar({
  id,
  status,
  saving,
  busy,
  canSave,
  canSubmit,
  canPublish,
  canReject,
  canUnpublish,
  canDelete,
  onSave,
  onTransition,
  onDelete,
}: {
  id: string | undefined;
  status: ArticleStatus;
  saving: boolean;
  busy: boolean;
  canSave: boolean;
  canSubmit: boolean;
  canPublish: boolean;
  canReject: boolean;
  canUnpublish: boolean;
  canDelete: boolean;
  onSave: () => void;
  onTransition: (
    endpoint: string,
    successMessage: string,
    body?: Record<string, unknown>,
  ) => void;
  onDelete: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-8 border-t bg-zinc-50/95 px-8 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSave} disabled={!canSave || busy}>
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
            onClick={() => onTransition("submit", "Submitted for review")}
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
              onTransition(
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
          <RejectDialog
            busy={busy}
            onReject={(reason) =>
              onTransition(
                "reject",
                "Article rejected",
                reason ? { reason } : undefined,
              )
            }
          />
        )}

        {canUnpublish && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onTransition("unpublish", "Article unpublished")}
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
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {id && (
          <Button asChild type="button" variant="ghost">
            <Link href={`/admin/blog/${id}/history`}>
              <History className="h-4 w-4" />
              History
            </Link>
          </Button>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          {busy ? "Working..." : "Changes save through the article API."}
        </div>
      </div>
    </div>
  );
}
