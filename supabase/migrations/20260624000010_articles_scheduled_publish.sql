-- 20260624000010_articles_scheduled_publish.sql
-- WS8 — Scheduled publish for blog articles.
--
-- Adds an explicit scheduled_publish_at to articles plus a pg_cron job that
-- flips ONLY explicitly-scheduled articles to `published` once their scheduled
-- time has passed. The manual publish flow (the publish API route) is left
-- entirely intact — it never sets scheduled_publish_at, so this job never
-- touches manually-published rows.
--
-- REQUIRES the pg_cron extension. On Supabase, enable it once per project
-- (Dashboard → Database → Extensions, or the statement below). pg_cron must be
-- installed into the `pg_catalog`-visible `cron` schema before cron.schedule()
-- can be called.

create extension if not exists pg_cron;

alter table public.articles
  add column if not exists scheduled_publish_at timestamptz;

-- Helps the cron job find due rows without a full scan.
create index if not exists articles_scheduled_publish_idx
  on public.articles (scheduled_publish_at)
  where scheduled_publish_at is not null and status <> 'published';

-- The function the cron job runs. Kept narrow and idempotent:
--   * Only rows with a non-null scheduled_publish_at that is due (<= now())
--     and not already published are eligible. A row that was published
--     manually (scheduled_publish_at stays null) is never matched.
--   * Only `draft`, `in_review`, and `unpublished` rows are advanced. Anything
--     already `published` is skipped, so re-running is safe.
--   * scheduled_publish_at is cleared after the flip so the row is not
--     reconsidered, and published_at is stamped to match the manual path.
--
-- NOTE on slug uniqueness: articles_slug_pub_idx is a partial unique index on
-- (slug) where status = 'published'. If a due row's slug already belongs to a
-- different published article the UPDATE for that row raises a unique-violation.
-- We isolate each row in its own statement-level handler so one conflicting
-- slug cannot block the rest of the batch; conflicting rows keep their schedule
-- cleared and stay un-published for an officer to resolve manually.
create or replace function public.publish_scheduled_articles()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  due_row record;
  published_count integer := 0;
begin
  for due_row in
    select id, slug
    from public.articles
    where scheduled_publish_at is not null
      and scheduled_publish_at <= now()
      and status in ('draft', 'in_review', 'unpublished')
    order by scheduled_publish_at asc
    for update skip locked
  loop
    begin
      update public.articles
      set status = 'published',
          published_at = now(),
          scheduled_publish_at = null,
          unpublished_at = null,
          unpublished_by = null
      where id = due_row.id;
      published_count := published_count + 1;
    exception
      when unique_violation then
        -- Slug already owned by another published article. Clear the schedule
        -- so the job stops retrying; an officer resolves the slug by hand.
        update public.articles
        set scheduled_publish_at = null
        where id = due_row.id;
    end;
  end loop;

  return published_count;
end;
$$;

-- Schedule the job once per minute. cron.schedule is idempotent on the job
-- name: re-running this migration (or re-applying after an edit) replaces the
-- existing schedule rather than stacking duplicates.
select cron.schedule(
  'publish-scheduled-articles',
  '* * * * *',
  $$select public.publish_scheduled_articles();$$
);
