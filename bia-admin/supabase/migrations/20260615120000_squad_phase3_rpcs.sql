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
language plpgsql stable security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
begin
  -- `status` is the POST's derived status (open/full/expired/closed) from
  -- squad_posts_with_status; the ping's delivery status is always 'sent' here (filtered below).
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
language plpgsql stable security definer set search_path = public as $$
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
language plpgsql stable security definer set search_path = public as $$
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
language plpgsql stable security definer set search_path = public as $$
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

-- 6) Respond to MY ping only; a single response is final.
create or replace function public.squad_respond_to_ping(p_ping_id uuid, p_response text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
  v_owner uuid; v_existing text;
begin
  if p_response not in ('joined','declined') then
    raise exception 'invalid_response' using errcode = '22023';
  end if;
  -- Atomic claim: only an unanswered ping that belongs to me gets written. This
  -- closes the check-then-update race — a concurrent second call finds response
  -- already set and updates 0 rows.
  update squad_pings
     set response = p_response, responded_at = now()
   where id = p_ping_id
     and recipient_student_id = v_student
     and response is null;
  if found then return; end if;
  -- Nothing updated — disambiguate why, for a precise error.
  select recipient_student_id, response into v_owner, v_existing
    from squad_pings where id = p_ping_id;
  if not found then raise exception 'ping_not_found' using errcode = 'P0002'; end if;
  if v_owner <> v_student then raise exception 'not_your_ping' using errcode = '42501'; end if;
  if v_existing is not null then raise exception 'already_responded' using errcode = 'P0001'; end if;
  raise exception 'respond_failed' using errcode = 'P0001';
end;
$$;

-- 7) Upsert my receiving prefs (re-validate the CHECK ranges defensively).
create or replace function public.squad_set_prefs(
  p_pings_enabled boolean, p_allowed_categories text[], p_weekly_cap int,
  p_quiet_start smallint, p_quiet_end smallint, p_channel text)
returns public.user_match_prefs
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
  v_row public.user_match_prefs;
begin
  if p_weekly_cap < 0 then raise exception 'invalid_cap' using errcode = '22023'; end if;
  if p_quiet_start < 0 or p_quiet_start > 23 or p_quiet_end < 0 or p_quiet_end > 23 then
    raise exception 'invalid_quiet_hours' using errcode = '22023'; end if;
  if p_channel not in ('imessage','web','email') then
    raise exception 'invalid_channel' using errcode = '22023'; end if;
  insert into user_match_prefs (student_id, pings_enabled, allowed_categories,
      weekly_ping_cap, quiet_start_hour, quiet_end_hour, channel, updated_at)
    values (v_student, p_pings_enabled, p_allowed_categories, p_weekly_cap,
      p_quiet_start, p_quiet_end, p_channel, now())
    on conflict (student_id) do update set
      pings_enabled = excluded.pings_enabled,
      allowed_categories = excluded.allowed_categories,
      weekly_ping_cap = excluded.weekly_ping_cap,
      quiet_start_hour = excluded.quiet_start_hour,
      quiet_end_hour = excluded.quiet_end_hour,
      channel = excluded.channel,
      updated_at = now()
    returning * into v_row;
  return v_row;
end;
$$;

-- 8a) Remove an interest signal (cheap; no embedding).
create or replace function public.squad_remove_interest(p_tag text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
begin
  update students set interest_tags = array_remove(interest_tags, p_tag) where id = v_student;
  delete from user_interest_vectors where student_id = v_student and label = p_tag;
end;
$$;

-- 8b) Add an interest signal. Tag is ALWAYS added (tag-overlap leg). The facet vector
-- is best-effort: only written when the caller supplies one (embed never blocks).
create or replace function public.squad_add_interest(p_tag text, p_vector float8[] default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_student uuid := squad_resolve_me();
begin
  update students set interest_tags =
    (select array(select distinct unnest(coalesce(interest_tags,'{}') || array[p_tag])))
    where id = v_student;
  if p_vector is not null and array_length(p_vector, 1) = 1536 then
    insert into user_interest_vectors (student_id, label, vector, source, updated_at)
    values (v_student, p_tag, ('[' || array_to_string(p_vector, ',') || ']')::vector, 'web', now())
    on conflict (student_id, label) do update set vector = excluded.vector, updated_at = now();
  end if;
end;
$$;

revoke all on function public.squad_respond_to_ping(uuid, text) from public, anon;
revoke all on function public.squad_set_prefs(boolean, text[], int, smallint, smallint, text) from public, anon;
revoke all on function public.squad_remove_interest(text) from public, anon;
revoke all on function public.squad_add_interest(text, float8[]) from public, anon;
grant execute on function public.squad_respond_to_ping(uuid, text) to authenticated, service_role;
grant execute on function public.squad_set_prefs(boolean, text[], int, smallint, smallint, text) to authenticated, service_role;
grant execute on function public.squad_remove_interest(text) to authenticated, service_role;
grant execute on function public.squad_add_interest(text, float8[]) to authenticated, service_role;
