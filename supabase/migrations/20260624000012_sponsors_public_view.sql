-- Fix: the original sponsors_public_read RLS policy (migration
-- 20260624000009) granted anon SELECT on ACTIVE rows — but a Postgres SELECT
-- policy filters rows, not columns, so anon could read every column including
-- the internal `notes` (labeled "内部备注（不公开）" in the admin UI) and
-- `contact`. Replace it with a safe projection.
--
-- The base table goes back to default-deny for anon (officers read/write via the
-- service-role client, which bypasses RLS). Public surfaces (uscbia.com) read
-- the `sponsors_public` view, which exposes ONLY the public-safe columns. The
-- view is SECURITY DEFINER (security_invoker = false) so it can project the
-- active rows past the now-closed table RLS — `notes`/`contact` are never
-- selected, so they cannot leak. (Supabase's advisor will flag this as a
-- definer view; that is intentional — it is the column-restriction boundary.)

drop policy if exists sponsors_public_read on public.sponsors;

create or replace view public.sponsors_public
  with (security_invoker = false) as
    select id, name, tier, logo_url, website_url, display_order
    from public.sponsors
    where active;

grant select on public.sponsors_public to anon, authenticated;
