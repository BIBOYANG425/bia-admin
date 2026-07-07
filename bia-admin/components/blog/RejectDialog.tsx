"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";

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

// Reject-to-draft confirmation. Owns the dialog open state and the note field;
// hands the trimmed reason back so the editor can run the transition.
export function RejectDialog({
  busy,
  onReject,
}: {
  busy: boolean;
  onReject: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
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
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="What needs to change before this can publish?"
          rows={4}
          disabled={busy}
          className="w-full resize-y rounded-md border bg-background p-3 text-sm leading-6 outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onReject(reason.trim());
              setReason("");
              setOpen(false);
            }}
            disabled={busy}
          >
            Send rejection
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
