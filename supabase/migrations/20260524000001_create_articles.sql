-- Blog articles per design doc rev 3.
-- Status machine: draft -> in_review -> published -> unpublished.

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  html_clean text not null,
  excerpt text,
  cover_image_url text,
  language text not null check (language in ('en', 'zh')),
  tags text[] not null default '{}',
  author_id uuid not null references public.admin_users(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'published', 'unpublished')),
  submitted_at timestamptz,
  submitted_by uuid references public.admin_users(id),
  published_at timestamptz,
  published_by uuid references public.admin_users(id),
  unpublished_at timestamptz,
  unpublished_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists articles_slug_pub_idx
  on public.articles (slug)
  where status = 'published';

create index if not exists articles_status_lang_pub_idx
  on public.articles (status, language, published_at desc nulls last);

create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists articles_set_updated_at on public.articles;
create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

alter table public.articles enable row level security;

drop policy if exists "articles_public_read_published" on public.articles;
create policy "articles_public_read_published"
  on public.articles
  for select
  to anon, authenticated
  using (status = 'published');
