-- supabase/migrations/20260615130000_squad_phase4_coordination.sql
-- Squad Phase 4: after-join coordination state. Read/written by george's Squad
-- Coordinator via the service-role client (cron) and the squad_rsvp tool — the
-- matching tables stay deny-all RLS, so no new policies are added here.
-- Spec: george/docs/superpowers/specs/2026-06-15-squad-phase4-coordination-design.md

-- Per-member RSVP. A drop DELETES the member row (capacity trigger decrements),
-- so there is no 'dropped_out' state to store — only pending/confirmed.
alter table public.squad_members
  add column if not exists rsvp_status text not null default 'pending'
    check (rsvp_status in ('pending','confirmed')),
  add column if not exists rsvp_at timestamptz;

-- Per-post coordination flags. reminder_sent_at + completed_at are one-shot;
-- needs_refill is re-settable (true on a drop, false after a refill fanout).
alter table public.squad_posts
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists needs_refill boolean not null default false;

-- Per-ping: the web-interest broker nudge fires once.
alter table public.squad_pings
  add column if not exists brokered_at timestamptz;

-- Keep the Coordinator's per-tick scans cheap.
create index if not exists squad_pings_broker_pending_idx
  on public.squad_pings (recipient_student_id)
  where brokered_at is null and response = 'joined';
create index if not exists squad_posts_active_deadline_idx
  on public.squad_posts (deadline)
  where completed_at is null;
