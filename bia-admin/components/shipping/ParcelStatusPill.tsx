import { PARCEL_STATUS_META, type ParcelStatus } from "@biboyang425/bia-shared/shipping";

// shadcn-flavored status badge (server-safe — no hooks). Maps the 4 semantic
// tones from PARCEL_STATUS_META onto Tailwind color classes, matching the
// blog StatusPill aesthetic.
const TONE_STYLES: Record<"pending" | "active" | "good" | "bad", string> = {
  pending: "border-zinc-200 bg-zinc-100 text-zinc-700",
  active: "border-amber-200 bg-amber-100 text-amber-800",
  good: "border-emerald-200 bg-emerald-100 text-emerald-800",
  bad: "border-rose-200 bg-rose-100 text-rose-800",
};

export function ParcelStatusPill({
  status,
  size = "md",
}: {
  status: ParcelStatus;
  size?: "sm" | "md";
}) {
  const meta = PARCEL_STATUS_META[status];
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex items-center rounded-md border font-medium ${pad} ${TONE_STYLES[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}
