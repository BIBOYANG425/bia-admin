import { type StatusTone } from "@/lib/shipping/labels";

// Generic status badge (server-safe — no hooks). Renders one label with the
// exact pill styling the shipping list pages used to hand-roll. The tone→class
// map below is byte-identical to the old per-page STATUS_CLASS strings; callers
// map their per-status enum to a `StatusTone` via the tone maps in
// lib/shipping/labels.ts.
//
// This is the generic pill; the parcel-specific pills in components/shipping/*
// (ParcelStatusPill, etc.) are intentionally left untouched.

const TONE_CLASS: Record<StatusTone, string> = {
  pending: "border-amber-200 bg-amber-100 text-amber-800",
  neutral: "border-zinc-200 bg-zinc-100 text-zinc-700",
  good: "border-emerald-200 bg-emerald-100 text-emerald-800",
  bad: "border-rose-200 bg-rose-100 text-rose-800",
  done: "border-slate-300 bg-slate-200 text-slate-800",
  muted: "border-zinc-200 bg-zinc-100 text-zinc-500",
  archived: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

export function StatusPill({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}
