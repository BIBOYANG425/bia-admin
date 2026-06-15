-- supabase/migrations/20260615120000_squad_phase3_rpcs.sql
-- Squad Phase 3: self-scoped RPCs for the web activity hub + receiving controls.
-- Spec 2026-06-15-squad-phase3-activity-controls-design.md. Every function derives
-- identity from auth.uid() via squad_resolve_me() (never a parameter) and is
-- authenticated-callable; the matching tables stay deny-all RLS underneath.

-- Shared resolver: auth.uid() -> students.id, JIT-provisioning a row (race-safe via
-- students_user_id_uidx). Mirrors the block in squad_board_for_me (20260613000006).
create or replace function public.squad_resolve_me()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_auth uuid := auth.uid();
  v_student uuid;
begin
  if v_auth is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select id into v_student from students where user_id = v_auth;
  if v_student is null then
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
  return v_student;
end;
$$;
revoke all on function public.squad_resolve_me() from public, anon;
grant execute on function public.squad_resolve_me() to authenticated, service_role;

-- 1) Inbox: my DELIVERED pings (status='sent') + post info + recomputed reason.
-- Reason isn't persisted on squad_pings, so recompute matched_tags / best_facet here.
create or replace function public.squad_my_pings()
returns table (
  ping_id uuid, post_id uuid, category text, content text, location text,
  poster_name text, current_people int, max_people int, status text,
  score double precision, response text, responded_at timestamptz,
  created_at timestamptz, matched_tags text[], best_facet text
)
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
begin
  return query
  select sp.id, sp.post_id, ps.category, ps.content, ps.location, ps.poster_name,
         ps.current_people, ps.max_people, ps.status, sp.score, sp.response,
         sp.responded_at, sp.created_at,
         array(select unnest(ps.tags) intersect select unnest(st.interest_tags)),
         (select uiv.label from user_interest_vectors uiv
            where uiv.student_id = v_student and ps.embedding is not null
            order by uiv.vector <=> ps.embedding limit 1)
  from squad_pings sp
  join squad_posts_with_status ps on ps.id = sp.post_id
  join students st on st.id = v_student
  where sp.recipient_student_id = v_student and sp.status = 'sent'
  order by sp.created_at desc;
end;
$$;

-- 2) Organizer view: my posts + AGGREGATE reach_count (never recipient ids — CEO D7).
create or replace function public.squad_my_posts()
returns table (
  post_id uuid, category text, content text, location text, status text,
  current_people int, max_people int, created_at timestamptz, reach_count bigint
)
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
begin
  return query
  select ps.id, ps.category, ps.content, ps.location, ps.status,
         ps.current_people, ps.max_people, ps.created_at,
         (select count(*) from squad_pings sp where sp.post_id = ps.id)
  from squad_posts_with_status ps
  where ps.created_by_student_id = v_student
  order by ps.created_at desc;
end;
$$;

-- 3) Joined: posts I'm a member of (student-keyed george joins OR user_id web joins).
create or replace function public.squad_my_joined()
returns table (
  post_id uuid, category text, content text, location text, status text,
  current_people int, max_people int, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
begin
  return query
  select ps.id, ps.category, ps.content, ps.location, ps.status,
         ps.current_people, ps.max_people, ps.created_at
  from squad_members sm
  join squad_posts_with_status ps on ps.id = sm.post_id
  where sm.student_id = v_student or sm.user_id = auth.uid()
  order by ps.created_at desc;
end;
$$;

-- 4) Receiving prefs (auto-create defaults: pings_enabled=false per CEO D5).
create or replace function public.squad_my_prefs()
returns public.user_match_prefs
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
  v_row public.user_match_prefs;
begin
  select * into v_row from user_match_prefs where student_id = v_student;
  if not found then
    insert into user_match_prefs (student_id) values (v_student)
    on conflict (student_id) do nothing;
    select * into v_row from user_match_prefs where student_id = v_student;
  end if;
  return v_row;
end;
$$;

-- 5) 匹配依据: whitelisted signals only (interest_tags + facet labels). No memory blocks.
create or replace function public.squad_my_signals()
returns table (interest_tags text[], facets json)
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
begin
  return query
  select coalesce(st.interest_tags, '{}'),
         coalesce((select json_agg(json_build_object(
                     'label', uiv.label, 'source', uiv.source, 'updated_at', uiv.updated_at)
                     order by uiv.updated_at desc)
                   from user_interest_vectors uiv where uiv.student_id = v_student), '[]'::json)
  from students st where st.id = v_student;
end;
$$;

revoke all on function public.squad_my_pings() from public, anon;
revoke all on function public.squad_my_posts() from public, anon;
revoke all on function public.squad_my_joined() from public, anon;
revoke all on function public.squad_my_prefs() from public, anon;
revoke all on function public.squad_my_signals() from public, anon;
grant execute on function public.squad_my_pings() to authenticated, service_role;
grant execute on function public.squad_my_posts() to authenticated, service_role;
grant execute on function public.squad_my_joined() to authenticated, service_role;
grant execute on function public.squad_my_prefs() to authenticated, service_role;
grant execute on function public.squad_my_signals() to authenticated, service_role;
