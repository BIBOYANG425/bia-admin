"use client";

import { CalendarClock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Scheduled-publish field. Renders the datetime input plus save/clear actions;
// the parent owns the PATCH that persists (or clears) the schedule.
export function ScheduleField({
  value,
  onChange,
  busy,
  saving,
  currentIso,
  onSave,
  onClear,
}: {
  value: string;
  onChange: (next: string) => void;
  busy: boolean;
  saving: boolean;
  currentIso: string | null;
  onSave: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <Label htmlFor="article-schedule">Scheduled publish</Label>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Set a future time to auto-publish this article. Leave empty (or
        clear) to publish manually. Times are in your local timezone.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="article-schedule"
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={busy}
          className="w-full sm:max-w-xs"
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onSave(value)}
            disabled={busy}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CalendarClock className="h-4 w-4" />
            )}
            Save schedule
          </Button>
          {currentIso && (
            <Button
              type="button"
              variant="outline"
              onClick={onClear}
              disabled={busy}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      {currentIso && (
        <p className="mt-2 text-xs text-emerald-700">
          Currently scheduled for{" "}
          {new Date(currentIso).toLocaleString()}.
        </p>
      )}
    </div>
  );
}
