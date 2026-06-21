-- student_confirm_pickup — let a student self-confirm parcel pickup in-app.
-- (Phase B · M3 · backs the "确认取件" button in bia-roommate.)
--
-- ✅ APPLIED to prod 2026-06-21 (via Supabase SQL editor). Idempotent
-- (CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS) — safe to re-apply for DR/rebuild.
--
-- WHY: parcels RLS only lets a student UPDATE their own row while
-- status='expected' (20260419_shipping.sql), so an arrived_us → picked_up
-- transition by the student MUST go through a SECURITY DEFINER RPC. We re-check
-- ownership inside the function via auth.uid() = user_id. Mirrors the GUC
-- stamping in admin_patch_parcel (20260423_admin_parcel_rpcs.sql) so the
-- existing log_parcel_status_change trigger records a parcel_events row.
--
-- actor_role: reuse the existing CHECK value 'user' (parcel_events.actor_role
-- ∈ user/admin/system) — semantically "the parcel owner did it"; avoids a
-- CHECK-widening migration.
--
-- The arrived_us → picked_up UPDATE also fires enqueue_parcel_notification,
-- enqueuing 'picked_up_thanks' (copy already exists). No extra wiring needed.

CREATE OR REPLACE FUNCTION public.student_confirm_pickup(p_parcel_id uuid)
RETURNS public.parcels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_cur  public.parcel_status;
  result public.parcels;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Ownership + current status, locked for the transition.
  SELECT status INTO v_cur
  FROM public.parcels
  WHERE id = p_parcel_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found_or_not_owner';
  END IF;

  -- Idempotent: already picked up → return current row, no event/notification.
  IF v_cur = 'picked_up'::public.parcel_status THEN
    SELECT p.* INTO result FROM public.parcels p WHERE p.id = p_parcel_id;
    RETURN result;
  END IF;

  -- Forward-only: only from the pickup-eligible state.
  IF v_cur <> 'arrived_us'::public.parcel_status THEN
    RAISE EXCEPTION 'not_pickup_eligible';
  END IF;

  PERFORM set_config('app.actor_user_id', v_uid::text, true);
  PERFORM set_config('app.actor_role', 'user', true);

  UPDATE public.parcels p
  SET status = 'picked_up'::public.parcel_status, updated_at = now()
  WHERE p.id = p_parcel_id
  RETURNING p.* INTO result;

  RETURN result;
END;
$$;

-- Student-callable (with the user's RLS client, so auth.uid() resolves).
REVOKE ALL ON FUNCTION public.student_confirm_pickup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_confirm_pickup(uuid) TO authenticated;
