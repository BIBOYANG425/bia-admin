-- Squad Phase 1: board RPC hardening + reason payload.
-- 1) hybrid_search_posts_for_user returns matched_tags so the UI can name the
--    overlap ("✦ 你们都喜欢 korean_food"), not just count it.
-- 2) squad_board_for_me(): SELF-SCOPED wrapper — derives auth.uid() → students.id
--    (JIT-provisioning a row via the students_user_id_uidx unique guard), so the
--    client never passes a student_id. Closes the probe hole where any
--    authenticated user could rank posts against ANOTHER student's vectors and
--    infer their interests.
-- 3) Raw per-student RPC becomes service_role-only.

drop function if exists public.hybrid_search_posts_for_user(uuid, int);

create or replace function public.hybrid_search_posts_for_user(
  p_student_id uuid,
  p_match_count int default 30
)
returns table (post_id uuid, rrf_score double precision, semantic_sim double precision,
               tag_overlap int, matched_tags text[], best_facet text)
language sql stable security definer set search_path = public as $$
  with me as (
    select coalesce(interest_tags, '{}') as tags from students where id = p_student_id
  ),
  open_posts as (
    select id, embedding, tags, fts from squad_posts_with_status
    where status = 'open' and category <> '约会'
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
           array(select unnest(op.tags) intersect select unnest(me.tags)) as overlap_tags
    from open_posts op, me
    where op.tags && me.tags
  ),
  tag_r as (select id, overlap_tags, cardinality(overlap_tags) as overlap,
                   rank() over (order by cardinality(overlap_tags) desc) as r from tag),
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
           s.sim, s.best_label, t.overlap, t.overlap_tags
    from sem_r s
    full outer join tag_r t on t.id = s.id
    full outer join fts_r f on f.id = coalesce(s.id, t.id)
  )
  select id, rrf, sim, coalesce(overlap, 0), coalesce(overlap_tags, '{}'), best_label
  from fused
  order by rrf desc
  limit p_match_count;
$$;

-- Self-scoped wrapper: identity comes from the JWT, never a parameter.
create or replace function public.squad_board_for_me(p_match_count int default 30)
returns table (post_id uuid, rrf_score double precision, semantic_sim double precision,
               tag_overlap int, matched_tags text[], best_facet text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_auth uuid := auth.uid();
  v_student uuid;
begin
  if v_auth is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select id into v_student from students where user_id = v_auth;
  if v_student is null then
    -- JIT provisioning (race-safe via students_user_id_uidx).
    begin
      insert into students (user_id, name)
      values (v_auth, coalesce(
        (select coalesce(raw_user_meta_data->>'full_name', email) from auth.users where id = v_auth),
        'USC student'))
      returning id into v_student;
    exception when unique_violation then
      select id into v_student from students where user_id = v_auth;
    end;
  end if;
  return query select * from hybrid_search_posts_for_user(v_student, p_match_count);
end;
$$;

-- Grants: wrapper for signed-in users; raw per-student RPC service_role only.
revoke all on function public.hybrid_search_posts_for_user(uuid, int) from public, anon, authenticated;
grant execute on function public.hybrid_search_posts_for_user(uuid, int) to service_role;
revoke all on function public.squad_board_for_me(int) from public, anon;
grant execute on function public.squad_board_for_me(int) to authenticated, service_role;
