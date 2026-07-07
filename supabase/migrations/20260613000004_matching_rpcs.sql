-- Squad Phase 0 (4/4): the matching RPCs (spec §6.1-§6.3, eng E6).
-- Direction 1: posts-for-user (board "for you") — 3 legs (semantic, fts, tag), RRF-fused.
-- Direction 2: users-for-post (pings) — semantic + tag legs only, PRE-FUSION GATE
--   (raw cosine/overlap floors — RRF scores are scale-free and cannot be thresholded),
--   and the consent gate (pings_enabled) enforced HERE, the lowest layer (CEO D5).
-- security definer + fixed search_path: these read RLS-protected tables by design;
-- they return ids + scores only, never profile content.

create or replace function public.hybrid_search_posts_for_user(
  p_student_id uuid,
  p_match_count int default 30
)
returns table (post_id uuid, rrf_score double precision, semantic_sim double precision,
               tag_overlap int, best_facet text)
language sql stable security definer set search_path = public as $$
  with me as (
    select coalesce(interest_tags, '{}') as tags from students where id = p_student_id
  ),
  open_posts as (
    select id, embedding, tags, fts from squad_posts_with_status
    where status = 'open' and category <> '约会'          -- platonic-only (spec §8)
  ),
  sem as (
    select op.id,
           max(1 - (uiv.vector <=> op.embedding)) as sim,
           (array_agg(uiv.label order by uiv.vector <=> op.embedding))[1] as best_label
    from open_posts op
    join user_interest_vectors uiv on uiv.student_id = p_student_id
    where op.embedding is not null
    group by op.id
  ),
  sem_r as (select id, sim, best_label, rank() over (order by sim desc) as r from sem),
  tag as (
    select op.id,
           cardinality(array(select unnest(op.tags) intersect select unnest(me.tags))) as overlap
    from open_posts op, me
    where op.tags && me.tags
  ),
  tag_r as (select id, overlap, rank() over (order by overlap desc) as r from tag),
  fts as (
    select op.id, ts_rank(op.fts, tq.q) as score
    from open_posts op
    cross join (select to_tsquery('simple',
                  nullif(array_to_string((select tags from me), ' | '), '')) as q) tq
    where tq.q is not null and op.fts @@ tq.q
  ),
  fts_r as (select id, score, rank() over (order by score desc) as r from fts),
  fused as (
    select coalesce(s.id, t.id, f.id) as id,
           coalesce(1.0/(60+s.r),0) + coalesce(1.0/(60+t.r),0) + coalesce(1.0/(60+f.r),0) as rrf,
           s.sim, s.best_label, t.overlap
    from sem_r s
    full outer join tag_r t on t.id = s.id
    full outer join fts_r f on f.id = coalesce(s.id, t.id)
  )
  select id, rrf, sim, coalesce(overlap, 0), best_label
  from fused
  order by rrf desc
  limit p_match_count;
$$;

create or replace function public.match_users_for_post(
  p_post_id uuid,
  p_semantic_floor double precision default 0.55,
  p_tag_floor int default 1,
  p_match_count int default 20,
  p_require_optin boolean default true
)
returns table (student_id uuid, rrf_score double precision, semantic_sim double precision,
               tag_overlap int, best_facet text)
language sql stable security definer set search_path = public as $$
  with post as (
    select id, embedding, tags, category, user_id, created_by_student_id
    from squad_posts where id = p_post_id and category <> '约会'
  ),
  sem as (
    select uiv.student_id,
           max(1 - (uiv.vector <=> post.embedding)) as sim,
           (array_agg(uiv.label order by uiv.vector <=> post.embedding))[1] as best_label
    from user_interest_vectors uiv, post
    where post.embedding is not null
    group by uiv.student_id
  ),
  tag as (
    select s.id as student_id,
           cardinality(array(select unnest(s.interest_tags) intersect select unnest(post.tags))) as overlap
    from students s, post
    where s.interest_tags && post.tags
  ),
  -- PRE-FUSION GATE (eng E6): floors on RAW similarity, before any rank fusion.
  candidates as (
    select coalesce(sem.student_id, tag.student_id) as student_id,
           coalesce(sem.sim, 0) as sim, sem.best_label, coalesce(tag.overlap, 0) as overlap
    from sem full outer join tag on tag.student_id = sem.student_id
    where coalesce(sem.sim, 0) >= p_semantic_floor or coalesce(tag.overlap, 0) >= p_tag_floor
  ),
  gated as (
    select c.* from candidates c
    cross join post
    left join user_match_prefs ump on ump.student_id = c.student_id
    where (not p_require_optin or coalesce(ump.pings_enabled, false))          -- CEO D5 consent
      and (ump.allowed_categories is null or post.category = any(ump.allowed_categories))
      and c.student_id is distinct from post.created_by_student_id            -- never ping organizer
      and not exists (select 1 from students s2 where s2.id = c.student_id
                        and post.user_id is not null and s2.user_id = post.user_id)
  ),
  sem_r as (select student_id, rank() over (order by sim desc) as r from gated where sim > 0),
  tag_r as (select student_id, rank() over (order by overlap desc) as r from gated where overlap > 0),
  fused as (
    select g.student_id, g.sim, g.best_label, g.overlap,
           coalesce(1.0/(60+s.r),0) + coalesce(1.0/(60+t.r),0) as rrf
    from gated g
    left join sem_r s on s.student_id = g.student_id
    left join tag_r t on t.student_id = g.student_id
  )
  select student_id, rrf, sim, overlap, best_label
  from fused
  order by rrf desc
  limit p_match_count;
$$;

-- Board RPC is callable by signed-in users; pings RPC is service-role only.
revoke all on function public.hybrid_search_posts_for_user(uuid, int) from public, anon;
grant execute on function public.hybrid_search_posts_for_user(uuid, int) to authenticated, service_role;
revoke all on function public.match_users_for_post(uuid, double precision, int, int, boolean) from public, anon, authenticated;
grant execute on function public.match_users_for_post(uuid, double precision, int, int, boolean) to service_role;
