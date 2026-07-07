-- Slice C: decision-tracking for the marketplace approval queue.
-- event_submissions already exists (george's submit_event enqueues 'pending'
-- rows). These columns record who decided, when, and why (on reject).
-- Append-only: never edit a migration that has been applied.

alter table public.event_submissions
  add column if not exists decided_by uuid references public.admin_users(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists reject_reason text;

-- Cap query: count approvals in a trailing 7-day window.
create index if not exists event_submissions_status_decided_at_idx
  on public.event_submissions (status, decided_at);
