-- approve_event_submission: atomically promote a pending event_submission into
-- the events table. Replaces the admin route's two separate service-role writes
-- (insert event, then update submission), which could leave an orphan event if
-- the second write failed. SECURITY DEFINER so the admin API can call it; the
-- API still gates with withRole('editor') and enforces the weekly cap before
-- calling. Mirrors the shipping module's atomic-RPC pattern.

create or replace function public.approve_event_submission(
  p_submission_id uuid,
  p_admin_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub   public.event_submissions%rowtype;
  v_event_id uuid;
begin
  -- Row-lock the submission so concurrent approvals can't double-insert.
  select * into v_sub
  from public.event_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'not_found';
  end if;
  if v_sub.status <> 'pending' then
    raise exception 'invalid_transition:%', v_sub.status;
  end if;

  insert into public.events (title, description, date, location, category, source, status)
  values (v_sub.title, v_sub.description, v_sub.date, v_sub.location, v_sub.category,
          'community', 'active')
  returning id into v_event_id;

  update public.event_submissions
  set status = 'approved',
      approved_event_id = v_event_id,
      decided_by = p_admin_id,
      decided_at = now()
  where id = p_submission_id;

  return v_event_id;
end;
$$;
