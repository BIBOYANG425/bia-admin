// Squad moderation surface (WS6) — shared types + label/tone metadata.
//
// The Squad backend predates this UI; these shapes mirror the live schema as
// defined by the squad migrations under the root supabase/migrations/:
//   - squad_posts / squad_posts_with_status   (20260613000001, +phase3/phase4 cols)
//   - squad_members                            (identity + rsvp, 20260615130000)
//   - squad_pings                              (matching_tables 20260613000002, +phases)
//
// `status` is DERIVED by the squad_posts_with_status view (security_invoker):
//   closed   → cancelled_at is set      (this is how a post is "cancelled")
//   full     → current_people >= max_people
//   expired  → deadline < now()
//   open     → otherwise
// There is no separate hidden/removed flag in the schema, so moderation =
// setting / clearing cancelled_at (→ status flips to/from 'closed').

export const SQUAD_POST_STATUS_VALUES = [
  "open",
  "full",
  "expired",
  "closed",
] as const;

export type SquadPostStatus = (typeof SQUAD_POST_STATUS_VALUES)[number];

type Tone = "active" | "good" | "pending" | "bad";

const TONE_STYLES: Record<Tone, string> = {
  pending: "border-zinc-200 bg-zinc-100 text-zinc-700",
  active: "border-emerald-200 bg-emerald-100 text-emerald-800",
  good: "border-sky-200 bg-sky-100 text-sky-800",
  bad: "border-rose-200 bg-rose-100 text-rose-800",
};

export const SQUAD_STATUS_META: Record<
  SquadPostStatus,
  { label: string; tone: Tone }
> = {
  open: { label: "招募中", tone: "active" },
  full: { label: "已满", tone: "good" },
  expired: { label: "已过期", tone: "pending" },
  closed: { label: "已取消", tone: "bad" },
};

export function squadStatusPillClass(status: SquadPostStatus): string {
  const meta = SQUAD_STATUS_META[status] ?? SQUAD_STATUS_META.open;
  return `inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_STYLES[meta.tone]}`;
}

export function squadStatusLabel(status: string): string {
  return (SQUAD_STATUS_META as Record<string, { label: string }>)[status]?.label ?? status;
}

// A post row as returned by squad_posts_with_status (all squad_posts columns +
// derived `status`). Only the fields the moderation UI reads are typed here.
export interface SquadPostRow {
  id: string;
  category: string | null;
  content: string | null;
  location: string | null;
  contact: string | null;
  poster_name: string | null;
  tags: string[] | null;
  status: SquadPostStatus;
  current_people: number | null;
  max_people: number | null;
  deadline: string | null;
  created_at: string;
  created_via: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  needs_refill: boolean | null;
  user_id: string | null;
  created_by_student_id: string | null;
}

// squad_members row (student-keyed george joins OR user_id web joins).
export interface SquadMemberRow {
  id: string;
  post_id: string;
  user_id: string | null;
  student_id: string | null;
  rsvp_status: "pending" | "confirmed" | null;
  rsvp_at: string | null;
  created_at: string | null;
}

// squad_pings row. `status` is the DELIVERY outcome; `response` is the
// recipient's reply (joined/declined/null = no reply yet).
export interface SquadPingRow {
  id: string;
  post_id: string;
  status: string;
  response: "joined" | "declined" | null;
}

export interface PingOutcomes {
  total: number;
  sent: number;
  suppressed: number;
  joined: number;
  declined: number;
  noReply: number;
}

export function tallyPingOutcomes(pings: SquadPingRow[]): PingOutcomes {
  const out: PingOutcomes = {
    total: pings.length,
    sent: 0,
    suppressed: 0,
    joined: 0,
    declined: 0,
    noReply: 0,
  };
  for (const p of pings) {
    if (p.status === "sent") out.sent += 1;
    else if (p.status.startsWith("suppressed")) out.suppressed += 1;

    if (p.response === "joined") out.joined += 1;
    else if (p.response === "declined") out.declined += 1;
    else out.noReply += 1;
  }
  return out;
}
