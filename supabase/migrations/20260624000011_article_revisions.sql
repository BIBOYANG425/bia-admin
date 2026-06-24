-- 20260624000011_article_revisions.sql
-- WS8 — Revision history for blog articles.
--
-- One row is appended on every article save (the article PATCH route). The
-- table is an append-only audit of content snapshots so an officer can see how
-- a draft evolved. It is admin-only: all reads and writes happen through the
-- service-role client in bia-admin's API routes. RLS is enabled with no policy,
-- so anon/authenticated access is denied by default (the public site must never
-- read draft snapshots).

create table if not exists public.article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  title text not null,
  body text not null,
  language text not null check (language in ('en', 'zh')),
  status text not null
    check (status in ('draft', 'in_review', 'published', 'unpublished')),
  edited_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- History is read newest-first, scoped to one article.
create index if not exists article_revisions_article_idx
  on public.article_revisions (article_id, created_at desc);

alter table public.article_revisions enable row level security;

-- Default deny. No policy is created on purpose: only the service-role client
-- (which bypasses RLS) may read or write revisions. anon and authenticated
-- callers get nothing.
