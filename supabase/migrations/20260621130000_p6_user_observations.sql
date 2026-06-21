-- P6 observational memory: an append-only, embedded, per-user observation log.
-- Separate layer from user_profiles (different shape: vectors + time-series;
-- different access pattern: semantic retrieval, not always-load). The george
-- heartbeat Reflector is the only bridge into user_profiles.
create extension if not exists vector;

create table if not exists public.user_observations (
  id              bigint generated always as identity primary key,
  user_id         uuid not null,
  content         text not null,
  embedding       vector(1536),
  salience        smallint not null default 3 check (salience between 1 and 5),
  kind            text,
  source          text not null default 'observer',
  created_at      timestamptz not null default now(),
  consolidated_at timestamptz
);

create index if not exists user_observations_user_created_idx
  on public.user_observations (user_id, created_at desc);
create index if not exists user_observations_embedding_idx
  on public.user_observations using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Blended recall: cosine similarity + recency decay + salience, salience-gated.
create or replace function public.recall_observations(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 4,
  p_min_salience int default 2,
  p_half_life_days double precision default 14
)
returns table (id bigint, content text, salience smallint, kind text, created_at timestamptz, score double precision)
language sql stable security definer set search_path = public as $$
  select o.id, o.content, o.salience, o.kind, o.created_at,
    (0.60 * (1 - (o.embedding <=> p_query_embedding))
     + 0.25 * exp(-(extract(epoch from (now() - o.created_at)) / 86400.0) / nullif(p_half_life_days,0))
     + 0.15 * (o.salience::double precision / 5.0)) as score
  from public.user_observations o
  where o.user_id = p_user_id
    and o.embedding is not null
    and o.salience >= p_min_salience
  order by score desc
  limit greatest(p_match_count, 1);
$$;

revoke all on function public.recall_observations(uuid, vector, int, int, double precision) from public;
grant execute on function public.recall_observations(uuid, vector, int, int, double precision) to service_role;
