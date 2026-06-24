-- article_comments: reader comments on published blog articles (uscbia.com).
-- Post-moderation model: comments are visible by default; BIA officers remove or
-- hide bad ones from /admin/comments. The public experience stays "normal" — no
-- pre-approval gate.
--
-- status: 'visible' (default, shown publicly) | 'hidden' (soft-hidden by an
-- officer, kept for audit) | 'deleted' (soft-deleted by a super_admin).

create table if not exists public.article_comments (
  id               uuid primary key default gen_random_uuid(),
  article_id       uuid not null references public.articles(id) on delete cascade,
  author_name      text,
  author_member_id text,
  body             text not null check (char_length(body) between 1 and 2000),
  status           text not null default 'visible'
                     check (status in ('visible', 'hidden', 'deleted')),
  created_at       timestamptz not null default now(),
  moderated_at     timestamptz,
  moderated_by     text
);

create index if not exists article_comments_article_idx
  on public.article_comments (article_id, created_at desc);
create index if not exists article_comments_status_idx
  on public.article_comments (status, created_at desc);

alter table public.article_comments enable row level security;

-- Public READ: anyone may read VISIBLE comments. Hidden/deleted are officer-only
-- (officers read via the service-role client, which bypasses RLS).
drop policy if exists article_comments_public_read on public.article_comments;
create policy article_comments_public_read
  on public.article_comments
  for select
  to anon, authenticated
  using (status = 'visible');

-- Public WRITE: anyone may post a comment, but only as 'visible', only on a
-- PUBLISHED article, and within the length bound. No update/delete for the
-- public — moderation is service-role only (default-deny covers the rest).
drop policy if exists article_comments_public_insert on public.article_comments;
create policy article_comments_public_insert
  on public.article_comments
  for insert
  to anon, authenticated
  with check (
    status = 'visible'
    and char_length(body) between 1 and 2000
    and exists (
      select 1 from public.articles a
      where a.id = article_id and a.status = 'published'
    )
  );
