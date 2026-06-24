-- admin_audit_log: append-only record of every state-changing admin action.
-- Mandatory per CLAUDE.md ("Audit log is mandatory for every state-changing
-- admin action"). Written exclusively by the service-role helper writeAudit()
-- (bia-admin/lib/admin/audit-log.ts) and read by the /admin/audit viewer (also
-- via the service-role client, which bypasses RLS).
--
-- Idempotent on purpose: the table already exists in production as untracked
-- schema drift (audit writes have been succeeding there), so `if not exists`
-- makes a prod apply a no-op while letting a fresh clone / dev branch stand the
-- table up from migrations. This restores the repo as schema source of truth
-- for this table ahead of the full baseline reconcile (WS0.1).
--
-- Column shapes verified against prod (2026-06-24): the timestamp column is
-- `ts` (NOT `created_at`) — matched here so a fresh rebuild equals prod.

create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  payload     jsonb not null default '{}'::jsonb,
  ts          timestamptz not null default now()
);

-- Indexes backing the /admin/audit viewer filters (entity_type · action ·
-- admin_email · date range), all newest-first.
create index if not exists admin_audit_log_ts_idx
  on public.admin_audit_log (ts desc);
create index if not exists admin_audit_log_entity_type_idx
  on public.admin_audit_log (entity_type, ts desc);
create index if not exists admin_audit_log_admin_email_idx
  on public.admin_audit_log (admin_email, ts desc);
create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log (action, ts desc);

-- RLS default-deny: the table is only ever touched by the service-role client
-- (which bypasses RLS). Enabling RLS with no policies blocks all anon/auth
-- access. `enable row level security` is idempotent if already enabled in prod.
alter table public.admin_audit_log enable row level security;
