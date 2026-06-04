// Stacked horizontal bar + legend showing parcel count per status across a
// batch. Server-safe. Ported from bia-roommate (Phase-3 slice 4), shadcn colors.

import {
  PARCEL_STATUS_META,
  type Parcel,
  type ParcelStatus,
} from "@biboyang425/bia-shared/shipping";

interface Props {
  parcels: Pick<Parcel, "status">[];
}

const TONE_BG: Record<"pending" | "active" | "good" | "bad", string> = {
  pending: "bg-zinc-200",
  active: "bg-amber-400",
  good: "bg-emerald-600",
  bad: "bg-rose-500",
};

export function BatchProgress({ parcels }: Props) {
  const counts = {} as Record<ParcelStatus, number>;
  for (const p of parcels) {
    counts[p.status] = (counts[p.status] ?? 0) + 1;
  }
  const total = parcels.length;

  if (total === 0) {
    return <p className="text-xs text-muted-foreground">暂无已关联的包裹</p>;
  }

  const segments = (Object.keys(counts) as ParcelStatus[])
    .filter((s) => counts[s] > 0)
    .sort((a, b) => counts[b] - counts[a]);

  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-md border bg-muted">
        {segments.map((s) => {
          const pct = (counts[s] / total) * 100;
          return (
            <div
              key={s}
              title={`${PARCEL_STATUS_META[s].label}: ${counts[s]}`}
              className={TONE_BG[PARCEL_STATUS_META[s].tone]}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {segments.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span
              className={`inline-block h-3 w-3 rounded-sm ${TONE_BG[PARCEL_STATUS_META[s].tone]}`}
            />
            <span>{PARCEL_STATUS_META[s].label}</span>
            <span className="text-muted-foreground">· {counts[s]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
