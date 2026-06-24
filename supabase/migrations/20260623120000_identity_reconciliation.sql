-- Identity reconciliation (Phase 1 — schema + RPC only).
--
-- Spec: george/docs/superpowers/specs/2026-06-22-identity-reconciliation-design.md
-- (§2 model, §4 the reconcile_identity RPC, §5 schema changes).
--
-- The disease: the same human becomes 2+ identities because the email-based web
-- account (auth.users) and the phone-based iMessage identity (students.imessage_id)
-- are only ever reconciled inside one web form. This migration installs the
-- single, atomic, idempotent merge primitive that every write path will call so
-- that one human == one students row, reachable by EITHER their canonical phone
-- (imessage_id) OR their auth account (user_id).
--
-- What this migration does, in order:
--   1. UNIQUE on public.pending_users.imessage_handle (the DB-level fork-stopper).
--   2. public.identity_conflicts table (two-auth-accounts-one-phone, human review).
--   3. public.repoint_student_fks(from, to) — re-points every FK child of
--      students.id from the dropped row to the kept row. Introspects pg_constraint
--      dynamically so new FKs are handled automatically; excludes the user_id-keyed
--      FKs (they reference students.user_id, not students.id).
--   4. public.reconcile_identity(auth_user_id, phone_e164, email) — the merge
--      algorithm from spec §4: create / backfill / merge, with the ambiguity guard.
--   5. Grants: service_role only.
--
-- IMPORTANT: this is schema + RPC ONLY. The one-time historical data-heal
-- (canonicalizing every stored handle, de-duping pending_users, and collapsing
-- existing split students rows by calling this RPC) is a SEPARATE later step
-- (spec §8) gated on dry-run + human sign-off. This migration installs no data
-- changes beyond the new constraint and the (currently empty) conflicts table.
-- Prod-apply of this migration is intentionally deferred to a human.

-- ---------------------------------------------------------------------------
-- 1. UNIQUE on the canonical handle. Handles are nullable; Postgres UNIQUE
--    permits multiple NULLs, so pending rows without a handle are unaffected.
--    Verified: 0 exact-duplicate handles currently, so this is safe to add now.
-- ---------------------------------------------------------------------------
alter table public.pending_users
  add constraint pending_users_imessage_handle_key unique (imessage_handle);

-- ---------------------------------------------------------------------------
-- 2. identity_conflicts: the rare "two different auth accounts both claim one
--    phone" case. Never auto-resolved; surfaced in the admin dashboard.
-- ---------------------------------------------------------------------------
create table if not exists public.identity_conflicts (
  id             bigint generated always as identity primary key,
  phone_e164     text,
  auth_user_id_a uuid,
  auth_user_id_b uuid,
  noticed_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

-- Order-independent uniqueness on the (phone, {a,b}) pair so that repeated
-- reconcile attempts collapse to one open conflict row (on conflict do nothing).
create unique index if not exists identity_conflicts_phone_pair_key
  on public.identity_conflicts (
    phone_e164,
    least(auth_user_id_a, auth_user_id_b),
    greatest(auth_user_id_a, auth_user_id_b)
  );

-- ---------------------------------------------------------------------------
-- 3. repoint_student_fks(p_from, p_to): re-point every child row that FKs
--    students.id (the PK) from p_from to p_to. Implemented DYNAMICALLY by
--    introspecting pg_constraint so that any future FK to students.id is handled
--    automatically. The user_id-keyed children (FK to students.user_id) are
--    deliberately EXCLUDED here — reconcile_identity handles those separately
--    when (defensively) the dropped row carried a user_id.
--
--    As of this migration the dynamically-enumerated set is exactly:
--      squad_posts.created_by_student_id, event_attendance.student_id,
--      pack_requests.student_id, students.referred_by (self-FK),
--      messages.student_id, event_submissions.student_id, reminders.student_id,
--      student_connections.student_a_id, student_connections.student_b_id,
--      proactive_log.student_id, sublets.student_id, parcels.student_id,
--      shipping_notifications.student_id, shipment_requests.student_id,
--      squad_members.student_id, user_interest_vectors.student_id,
--      user_match_prefs.student_id, squad_pings.recipient_student_id.
-- ---------------------------------------------------------------------------
create or replace function public.repoint_student_fks(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r            record;
  v_child_tbl  text;
  v_child_sch  text;
  v_child_col  text;
  v_pk_attnum  smallint;
  i            int;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return;
  end if;

  -- Find the attnum of students.id (the referenced PK column) so we only match
  -- FKs that reference students.id, not students.user_id.
  select a.attnum into v_pk_attnum
  from pg_attribute a
  where a.attrelid = 'public.students'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  -- Loop over every FK constraint whose referenced table is public.students.
  -- confkey/conkey are parallel arrays: confkey[i] is the referenced column's
  -- attnum, conkey[i] is the child column's attnum. We re-point only the
  -- positions that reference students.id. student_connections has two separate
  -- single-column FKs (student_a_id and student_b_id), so it shows up as two
  -- constraint rows here and both get re-pointed; the array walk also covers any
  -- future multi-column FK to students.id, so the logic is general.
  for r in
    select c.oid           as conoid,
           c.conrelid      as child_relid,
           c.conkey        as child_attnums,
           c.confkey       as ref_attnums
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.students'::regclass
  loop
    v_child_sch := (select n.nspname
                    from pg_class cl
                    join pg_namespace n on n.oid = cl.relnamespace
                    where cl.oid = r.child_relid);
    v_child_tbl := (select cl.relname from pg_class cl where cl.oid = r.child_relid);

    -- Walk the parallel arrays; act only on columns that reference students.id.
    for i in 1 .. array_length(r.ref_attnums, 1) loop
      if r.ref_attnums[i] = v_pk_attnum then
        v_child_col := (select a.attname
                        from pg_attribute a
                        where a.attrelid = r.child_relid
                          and a.attnum = r.child_attnums[i]
                          and not a.attisdropped);

        -- Re-point this child column from p_from to p_to. The extra
        -- "and %I <> $1" guard makes the self-FK (students.referred_by) safe:
        -- a row never ends up referencing itself, and the kept row is never
        -- touched into a self-reference. Identifiers via %I, values bound.
        execute format(
          'update %I.%I set %I = $1 where %I = $2 and %I <> $1',
          v_child_sch, v_child_tbl, v_child_col, v_child_col, v_child_col
        ) using p_to, p_from;
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. reconcile_identity: the single merge algorithm (spec §4). SECURITY DEFINER,
--    service-role only, one plpgsql function == one transaction (atomic), and
--    idempotent (same inputs twice == no-op after the first).
--
--    Returns the canonical students row's (id, user_id) after ensuring exactly
--    one row holds all known keys.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_identity(
  p_auth_user_id uuid default null,   -- from a logged-in web session
  p_phone_e164   text default null,   -- canonical E.164 (normalized by the caller)
  p_email        text default null    -- for resolving the auth link (no creation here)
)
returns table (student_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth     uuid := p_auth_user_id;
  v_by_auth  public.students;
  v_by_phone public.students;
  v_keep     public.students;
  v_drop     public.students;
begin
  -- 1. Resolve auth account from email if not passed. We never CREATE auth.users
  --    here; auth-user creation stays in the web layer. This function only LINKS
  --    what already exists.
  if v_auth is null and p_email is not null then
    select id into v_auth
    from auth.users
    where lower(email) = lower(p_email)
    limit 1;
  end if;

  -- 2. Find candidate student rows by each key.
  if v_auth is not null then
    select * into v_by_auth
    from public.students
    where user_id = v_auth
    limit 1;
  end if;
  if p_phone_e164 is not null then
    select * into v_by_phone
    from public.students
    where imessage_id = p_phone_e164
    limit 1;
  end if;

  -- 3a. Neither exists → create one with whatever keys we have.
  if v_by_auth.id is null and v_by_phone.id is null then
    insert into public.students (user_id, imessage_id)
    values (v_auth, p_phone_e164)
    returning * into v_keep;

  -- 3b. Only the phone-row exists → backfill the auth link onto it.
  elsif v_by_auth.id is null then
    v_keep := v_by_phone;
    if v_auth is not null and v_keep.user_id is null then
      update public.students
        set user_id = v_auth, updated_at = now()
        where id = v_keep.id
        returning * into v_keep;
    end if;

  -- 3c. Only the auth-row exists → backfill the phone onto it.
  elsif v_by_phone.id is null then
    v_keep := v_by_auth;
    if p_phone_e164 is not null and v_keep.imessage_id is null then
      update public.students
        set imessage_id = p_phone_e164, updated_at = now()
        where id = v_keep.id
        returning * into v_keep;
    end if;

  -- 3d. Two DIFFERENT rows → MERGE the split. Keep the auth-linked row.
  elsif v_by_auth.id <> v_by_phone.id then

    -- AMBIGUITY GUARD: the phone row is already bound to a DIFFERENT auth
    -- account. Two distinct humans (or a recycled phone) — do NOT steal it.
    -- Log for human review and return the auth row UNCHANGED. This guard runs
    -- BEFORE any destructive operation.
    if v_by_phone.user_id is not null
       and v_by_phone.user_id is distinct from v_by_auth.user_id then
      insert into public.identity_conflicts (phone_e164, auth_user_id_a, auth_user_id_b, noticed_at)
      values (p_phone_e164, v_by_auth.user_id, v_by_phone.user_id, now())
      on conflict do nothing;
      return query select v_by_auth.id, v_by_auth.user_id;
      return;  -- no merge
    end if;

    v_keep := v_by_auth;
    v_drop := v_by_phone;

    -- Re-point every FK child of students.id from the dropped row to the kept row.
    perform public.repoint_student_fks(v_drop.id, v_keep.id);

    -- Defensive: if the dropped row somehow carried a user_id (it should not,
    -- post-guard, since a non-null differing user_id would have been caught and
    -- an equal user_id means same auth account), re-point the user_id-keyed
    -- children and merge user_profiles before we null its keys.
    if v_drop.user_id is not null and v_drop.user_id <> v_keep.user_id then
      update public.user_heartbeat_config        set user_id = v_keep.user_id where user_id = v_drop.user_id;
      update public.user_heartbeat_instructions   set user_id = v_keep.user_id where user_id = v_drop.user_id;
      update public.heartbeat_log                 set user_id = v_keep.user_id where user_id = v_drop.user_id;
      update public.student_followups             set user_id = v_keep.user_id where user_id = v_drop.user_id;

      -- Merge user_profiles content: prefer the keep row's non-empty block,
      -- fall back to the drop row's block. Never overwrite a non-empty keep
      -- block with the drop's value (memory loss is the worst outcome). Only
      -- merge when the keep row actually has a user_profiles row; otherwise
      -- re-point the drop's profile wholesale.
      if exists (select 1 from public.user_profiles where user_id = v_keep.user_id)
         and exists (select 1 from public.user_profiles where user_id = v_drop.user_id) then
        update public.user_profiles k
          set identity          = case when nullif(btrim(coalesce(k.identity,          '')), '') is null then d.identity          else k.identity          end,
              academic          = case when nullif(btrim(coalesce(k.academic,          '')), '') is null then d.academic          else k.academic          end,
              interests         = case when nullif(btrim(coalesce(k.interests,         '')), '') is null then d.interests         else k.interests         end,
              relationships     = case when nullif(btrim(coalesce(k.relationships,     '')), '') is null then d.relationships     else k.relationships     end,
              state             = case when nullif(btrim(coalesce(k.state,             '')), '') is null then d.state             else k.state             end,
              george_notes      = case when nullif(btrim(coalesce(k.george_notes,      '')), '') is null then d.george_notes      else k.george_notes      end,
              relationship_note = case when nullif(btrim(coalesce(k.relationship_note, '')), '') is null then d.relationship_note else k.relationship_note end,
              updated_at        = now()
          from public.user_profiles d
          where k.user_id = v_keep.user_id and d.user_id = v_drop.user_id;
        delete from public.user_profiles where user_id = v_drop.user_id;
      else
        -- keep has no profile (or drop has none): hand the drop's profile over.
        update public.user_profiles set user_id = v_keep.user_id where user_id = v_drop.user_id;
      end if;
    end if;

    -- Null the dropped row's UNIQUE keys FIRST so the coalesce below can move
    -- the phone (imessage_id) onto the kept row without tripping the UNIQUE
    -- constraint on students.imessage_id (and the UNIQUE on user_id). The drop
    -- row's field values were captured into the v_drop record at branch entry,
    -- so they survive this in-place null-out and remain usable in the coalesce.
    update public.students set imessage_id = null, user_id = null where id = v_drop.id;

    -- Coalesce useful fields from the dropped row onto the kept row.
    update public.students
      set imessage_id         = coalesce(v_keep.imessage_id, v_drop.imessage_id),
          onboarding_complete = coalesce(v_keep.onboarding_complete, false)
                                or coalesce(v_drop.onboarding_complete, false),
          name                = coalesce(v_keep.name,  v_drop.name),
          major               = coalesce(v_keep.major, v_drop.major),
          year                = coalesce(v_keep.year,  v_drop.year),
          updated_at          = now()
      where id = v_keep.id
      returning * into v_keep;

    -- The dropped row now holds no unique keys; remove it.
    delete from public.students where id = v_drop.id;

  -- 3e. Same row found by both keys → nothing to do.
  else
    v_keep := v_by_auth;
  end if;

  return query select v_keep.id, v_keep.user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants: service_role only (both functions are SECURITY DEFINER and must
--    never be callable by anon / authenticated).
-- ---------------------------------------------------------------------------
revoke all on function public.repoint_student_fks(uuid, uuid) from public;
revoke all on function public.reconcile_identity(uuid, text, text) from public;
grant execute on function public.repoint_student_fks(uuid, uuid) to service_role;
grant execute on function public.reconcile_identity(uuid, text, text) to service_role;
