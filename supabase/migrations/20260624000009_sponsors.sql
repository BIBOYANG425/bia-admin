-- sponsors: BIA's event / recruiting / local-service / payment partners.
-- Managed by officers from /admin/sponsors. Greenfield — no prior data layer.
--
-- Sponsors may later be surfaced on uscbia.com, so anon/authenticated get a
-- public READ policy scoped to active rows only. All writes go through the
-- service-role client from bia-admin (service-role bypasses RLS), so there is
-- no public insert/update/delete policy — default-deny covers the rest.
--
-- tier: 'event' | 'recruiting' | 'local_service' | 'payment'.

create table if not exists public.sponsors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  tier          text check (tier in ('event', 'recruiting', 'local_service', 'payment')),
  contact       text,
  logo_url      text,
  website_url   text,
  notes         text,
  active        boolean not null default true,
  display_order int not null default 0,
  created_at    timestamptz default now()
);

create index if not exists sponsors_active_order_idx
  on public.sponsors (active, display_order);
create index if not exists sponsors_order_idx
  on public.sponsors (display_order);

alter table public.sponsors enable row level security;

-- Public READ: anyone may read ACTIVE sponsors (for surfacing on uscbia.com).
-- Inactive/retired sponsors are officer-only (officers read via service-role,
-- which bypasses RLS). No public write policy — writes are service-role only.
drop policy if exists sponsors_public_read on public.sponsors;
create policy sponsors_public_read
  on public.sponsors
  for select
  to anon, authenticated
  using (active);

-- Public bucket for sponsor logos. Uploads are signed by bia-admin via the
-- service-role client. public = true gives anon read; service-role bypasses
-- RLS for writes (mirrors the article-covers storage bucket pattern).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sponsor-logos',
  'sponsor-logos',
  true,
  2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
