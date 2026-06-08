-- iMessage outgoing queue used by Path B (iPhone Shortcuts mode).
--
-- When the China side runs iMessage via Apple Shortcuts on a dedicated iPhone
-- (no Mac available), the Cloudflare Container's /imessage/incoming endpoint
-- runs processMessage and writes the reply to this table. A Personal Automation
-- on the iPhone polls /imessage/outgoing (which selects status='pending') every
-- minute, sends each via the Messages.app Shortcut action, then POSTs to
-- /imessage/outgoing/:id/ack to flip status to 'sent' (or 'failed').
--
-- Path A (Mac mini bridge) does NOT use this table — replies travel back over
-- the inline /chat HTTP response.

create table public.imessage_outgoing (
  id          uuid primary key default gen_random_uuid(),
  recipient   text not null,
  text        text not null,
  queued_at   timestamptz not null default now(),
  sent_at     timestamptz,
  status      text not null default 'pending'
              check (status in ('pending', 'sent', 'failed')),
  error       text
);

-- Polling Shortcut hits this hot path every minute; partial index keeps the
-- query fast even after thousands of historical rows accumulate.
create index imessage_outgoing_pending_idx
  on public.imessage_outgoing (queued_at)
  where status = 'pending';

-- This table is service-role only. The iPhone Shortcut authenticates via the
-- Container's ADMIN_TOKEN_PHONE bearer; it never talks to Supabase directly.
-- Anon should have no access.
alter table public.imessage_outgoing enable row level security;
-- No policies = default deny for anon + authenticated. Service role bypasses RLS.
