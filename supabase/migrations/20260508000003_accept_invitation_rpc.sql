-- accept_invitation: atomic invite acceptance.
-- Inserts an admin_users row and marks the matching invitation accepted
-- in one transaction. Returns the inserted (or already-existing) admin
-- row as JSON.
--
-- Idempotent on the admin_users insert via on conflict do nothing — if
-- the caller retries (browser refresh on partial failure), the second
-- call is a no-op rather than an error.

create or replace function public.accept_invitation(
  p_invitation_id uuid,
  p_user_id uuid,
  p_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_admin record;
begin
  -- Lock the invitation row and read its role.
  select role into v_role
    from public.admin_invitations
    where id = p_invitation_id and accepted_at is null
    for update;

  if v_role is null then
    raise exception 'invitation_not_found_or_already_accepted'
      using errcode = 'P0001';
  end if;

  -- Insert the admin_users row (or no-op on duplicate).
  insert into public.admin_users (id, email, role)
    values (p_user_id, p_email, v_role)
    on conflict (id) do nothing;

  select id, email, role, created_at into v_admin
    from public.admin_users
    where id = p_user_id;

  -- Mark invitation accepted.
  update public.admin_invitations
    set accepted_at = now()
    where id = p_invitation_id;

  return jsonb_build_object(
    'id', v_admin.id,
    'email', v_admin.email,
    'role', v_admin.role,
    'created_at', v_admin.created_at
  );
end;
$$;

revoke all on function public.accept_invitation(uuid, uuid, text) from public;
grant execute on function public.accept_invitation(uuid, uuid, text) to service_role;
