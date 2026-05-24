-- 20260524000003_articles_slug_widen_unique.sql
-- Prevent slug collisions before publish, not at publish time.
-- Drafts may freely share slugs; once moving past draft, slug must be unique.

drop index if exists public.articles_slug_pub_idx;

create unique index if not exists articles_slug_nondraft_uniq_idx
  on public.articles (slug)
  where status in ('in_review', 'published', 'unpublished');
