-- admin_users: who can access admin.uscbia.com and at what tier.
-- One row per officer. id is the FK to auth.users.id so the row
-- vanishes on auth user deletion.

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('super_admin','editor','viewer')),
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- Authenticated users may read their own row only. All admin reads of
-- the full table happen via service-role from bia-admin's API routes.
drop policy if exists "self read" on public.admin_users;
create policy "self read" on public.admin_users
  for select to authenticated
  using (id = auth.uid());

create index if not exists admin_users_email_idx on public.admin_users (email);
