-- Pacing & Delivery v1 (george): restart-durable outgoing-bubble queue.
-- Spec: george/docs/superpowers/specs/2026-06-22-pacing-delivery-handoff.md §5.2.
--
-- George's multi-bubble replies send bubble 1 inline (responsiveness) and persist
-- bubbles 2..N here with a computed `send_at`. A ~1s in-process drainer in the
-- george agent (Spectrum adapter only) selects due rows, sends via Spectrum, and
-- stamps `sent_at`. On restart the drainer simply finds the not-yet-sent rows and
-- resumes — that is the durability win versus today's in-process setTimeout loop.
--
-- This is a transient send queue keyed by the recipient iMessage handle (the
-- Spectrum send target). Rows are short-lived: marked `sent_at` after delivery,
-- or deleted by `cancelPending(handle)` when a new inbound aborts a pending burst.
-- A later prune job may delete old `sent_at`-stamped rows.
--
-- RLS = enabled with ZERO policies → anon/authenticated denied, service-role
-- bypasses (george writes/reads with the service-role key only). Same deny-all
-- pattern as the matching-engine tables (20260613000002).

create table if not exists public.outgoing_bubbles (
  id uuid primary key default gen_random_uuid(),
  handle text not null,                                   -- recipient iMessage handle (Spectrum send target)
  content text not null,                                  -- the bubble text to send
  seq int not null,                                       -- position within the burst (1..N; bubble 0 sent inline)
  send_at timestamptz not null,                           -- when the drainer should send this bubble
  sent_at timestamptz,                                    -- stamped after a successful send (null = pending)
  created_at timestamptz not null default now()
);

-- Drainer hot path: "due and not yet sent", oldest first.
create index if not exists outgoing_bubbles_due_idx
  on public.outgoing_bubbles (send_at)
  where sent_at is null;

-- cancelPending(handle): fast lookup of a handle's still-pending bubbles.
create index if not exists outgoing_bubbles_handle_pending_idx
  on public.outgoing_bubbles (handle)
  where sent_at is null;

-- Prune support: reclaim old delivered rows by age.
create index if not exists outgoing_bubbles_created_idx
  on public.outgoing_bubbles (created_at);

-- Deny-all RLS: enable, define NO policies. service-role bypasses RLS.
alter table public.outgoing_bubbles enable row level security;
