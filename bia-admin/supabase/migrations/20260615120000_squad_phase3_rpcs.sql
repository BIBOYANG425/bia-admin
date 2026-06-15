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
