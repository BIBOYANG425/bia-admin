-- Squad Phase 0 (1/4): identity columns, cancellation, content-match columns, status view.
-- Spec: squad-reimagined §9 (eng E1/E4). Append-only; applied via Supabase MCP.

-- squad_posts: george-created posts carry a students FK (auth.users FK stays for web posts).
alter table public.squad_posts
  add column if not exists created_by_student_id uuid references public.students(id) on delete set null,
  add column if not exists created_via text not null default 'web'
    check (created_via in ('web','george')),
  add column if not exists cancelled_at timestamptz,
  add column if not exists tags text[] not null default '{}',
  add column if not exists embedding vector(1536);

-- fts: 'simple' config (Chinese isn't stemmed by 'english' anyway; the tag leg carries CN).
alter table public.squad_posts
  add column if not exists fts tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(content,'') || ' ' || coalesce(category,'') || ' ' || coalesce(location,''))
  ) stored;

create index if not exists squad_posts_tags_gin on public.squad_posts using gin (tags);
create index if not exists squad_posts_fts_gin on public.squad_posts using gin (fts);
create index if not exists squad_posts_embedding_idx on public.squad_posts
  using ivfflat (embedding vector_cosine_ops) with (lists = 10);

-- squad_members: allow george-brokered joins (students-keyed) — eng E1.
alter table public.squad_members
  add column if not exists student_id uuid references public.students(id) on delete cascade;
alter table public.squad_members alter column user_id drop not null;
alter table public.squad_members
  add constraint squad_members_identity_check
  check (user_id is not null or student_id is not null);
create unique index if not exists squad_members_post_student_uidx
  on public.squad_members (post_id, student_id) where student_id is not null;

-- Derived status (eng E4): open/full/expired derive; only cancellation is stored.
create or replace view public.squad_posts_with_status
with (security_invoker = true) as
select p.*,
  case
    when p.cancelled_at is not null then 'closed'
    when p.current_people >= p.max_people then 'full'
    when p.deadline is not null and p.deadline < now() then 'expired'
    else 'open'
  end as status
from public.squad_posts p;

grant select on public.squad_posts_with_status to anon, authenticated;
