-- supabase/migrations/20260619120000_squad_pings_rereached_at.sql
-- Re-reach dedup stamp for george's re-reach evaluator (Track 2 evaluator family).
-- Read/written by george via the service-role client (cron) in
-- src/services/reach-eval-deps.ts (markReached / alreadyReached / selectReachCandidates).
-- Gated behind george's SQUAD_REREACH_EVAL_ENABLED (default OFF); this column must
-- ship here FIRST since george only reads/writes existing tables.
-- Distinct from the Squad Coordinator's idempotency columns (brokered_at /
-- reminder_sent_at / completed_at / needs_refill) so a re-reach never races a live
-- reminder. The matching tables stay deny-all RLS, so no new policies are added.

-- NULL = this joined-but-not-brokered ping has not been gently re-reached yet.
-- Set to now() when george sends the stalled-post nudge, so it is never nudged again.
alter table public.squad_pings
  add column if not exists rereached_at timestamptz;

comment on column public.squad_pings.rereached_at is
  'Set when george''s re-reach evaluator has nudged a stalled joined-but-not-brokered ping, so it is not re-reached again. NULL = not yet re-reached. Owned by SQUAD_REREACH_EVAL_ENABLED; distinct from brokered_at/reminder_sent_at/completed_at.';

-- Partial index for the re-reach cron scan: joined pings that were never brokered
-- and never re-reached. Keeps the */N cron candidate query cheap as squad_pings grows.
create index if not exists idx_squad_pings_rereach_scan
  on public.squad_pings (post_id)
  where response = 'joined' and brokered_at is null and rereached_at is null;
