-- admin_invitations: pending invites by email. When an invitee signs in
-- (Google OAuth or magic link), the auth callback finds their pending
-- invitation by email and creates the corresponding admin_users row via
-- the accept_invitation RPC (migration 20260508000003).

create table if not exists public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null check (role in ('super_admin','editor','viewer')),
  invited_by uuid references public.admin_users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.admin_invitations enable row level security;

-- No policies: writes/reads happen only via service-role from bia-admin.

create index if not exists admin_invitations_email_idx
  on public.admin_invitations (email)
  where accepted_at is null;

create unique index if not exists admin_invitations_pending_email_idx
  on public.admin_invitations (lower(email))
  where accepted_at is null;
