-- George memory consolidation — additive schema (Phase 0).
-- Spec: george/docs/superpowers/specs/2026-06-21-memory-consolidation-design.md
-- Additive only: safe to apply on the live DB; no drops, no data movement.

-- relationship note + compaction marker on the learned-memory profile
alter table public.user_profiles
  add column if not exists relationship_note text,
  add column if not exists compaction_due timestamptz;

-- proactive raised-thread ledger (was line-stuffed into george_notes)
create table if not exists public.proactive_raised_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  thread text not null,
  raised_at timestamptz not null default now()
);
create index if not exists idx_raised_threads_user on public.proactive_raised_threads (user_id);
create unique index if not exists uq_raised_threads_user_thread on public.proactive_raised_threads (user_id, thread);

-- atomic, deduped append to one profile block (kills the read-modify-write race)
create or replace function public.append_to_profile_block(
  p_user_id uuid, p_block text, p_addition text
) returns void
language plpgsql security definer
as $$
declare
  v_current text;
  v_addition text := btrim(p_addition);
begin
  if p_block not in ('identity','academic','interests','relationships','state','george_notes') then
    raise exception 'invalid block name: %', p_block;
  end if;
  if v_addition = '' then return; end if;

  insert into public.user_profiles (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  execute format('select %I from public.user_profiles where user_id = $1', p_block)
    into v_current using p_user_id;
  v_current := coalesce(v_current, '');

  -- dedupe: skip if any existing line equals or contains the addition
  if exists (
    select 1 from unnest(string_to_array(v_current, E'\n')) ln
    where position(v_addition in btrim(ln)) > 0
  ) then
    return;
  end if;

  execute format(
    'update public.user_profiles set %I = case when coalesce(%I,'''') = '''' then $2 else %I || E''\n'' || $2 end, '
    || 'compaction_due = case when length(coalesce(%I,'''')) + length($2) + 1 > 4000 then now() else compaction_due end, '
    || 'updated_at = now() where user_id = $1', p_block, p_block, p_block, p_block)
    using p_user_id, v_addition;
end $$;
