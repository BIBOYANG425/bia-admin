-- Detach + reassign RPCs (2026-07-03 shipping refinement, SR-7).
-- Idempotent CREATE OR REPLACE; no data touched. NOT YET APPLIED TO PROD.
--
-- WHY
-- ───
-- 1. Mis-attach was unrecoverable in the UI: attach is one click
--    (received_cn -> in_transit + shipment_id) but there was NO inverse —
--    a parcel batched into the wrong shipment stayed there.
--    admin_detach_parcels_from_shipment reverses exactly the attach move,
--    and only while the batch is still physically at the warehouse
--    (forming/sealed) and the parcel still in_transit ON this batch.
-- 2. Parcel identity was immutable after creation: no mutation path touched
--    member_id/student_id/user_id, so a typo'd member_id or a wrong-student
--    match permanently mis-routed notifications, student visibility, the
--    pickup QR and payment dunning. admin_reassign_parcel_student re-points
--    the parcel and re-derives the students link (member_id is UNIQUE on
--    public.students per bia-roommate 20260419_shipping.sql), writing a
--    parcel_events note so the timeline shows the correction.

-- ─────────────────────────────────────────────────────────────────────────
-- 1 — detach: the exact inverse of admin_attach_parcels_to_shipment.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_detach_parcels_from_shipment(
  p_parcel_ids uuid[],
  p_shipment_id uuid,
  p_actor_user_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship_status text;
  updated_count int;
BEGIN
  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  -- Same lock discipline as attach: serialize against a concurrent
  -- seal/depart so parcels can't silently leave a batch that already flew.
  SELECT status INTO v_ship_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF v_ship_status IS NULL OR v_ship_status NOT IN ('forming', 'sealed') THEN
    RAISE EXCEPTION 'shipment_not_detachable: %', COALESCE(v_ship_status, 'missing');
  END IF;

  -- Only parcels that are in_transit ON THIS shipment (i.e. exactly what
  -- attach produced) go back to received_cn + unassigned.
  UPDATE public.parcels
  SET shipment_id = NULL,
      status      = 'received_cn'::public.parcel_status,
      updated_at  = now()
  WHERE id = ANY(p_parcel_ids)
    AND shipment_id = p_shipment_id
    AND status = 'in_transit'::public.parcel_status;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_detach_parcels_from_shipment(uuid[], uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2 — reassign a parcel to a (possibly different) student.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reassign_parcel_student(
  p_parcel_id uuid,
  p_member_id text,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member     text := btrim(COALESCE(p_member_id, ''));
  v_cur_status public.parcel_status;
  v_old_member text;
  v_student_id uuid;
  v_user_id    uuid;
  result       public.parcels;
BEGIN
  IF length(v_member) < 1 THEN
    RAISE EXCEPTION 'member_id_required';
  END IF;

  SELECT status, member_id INTO v_cur_status, v_old_member
  FROM public.parcels
  WHERE id = p_parcel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  -- A delivered parcel's identity is settled — no re-pointing after pickup.
  IF v_cur_status = 'picked_up'::public.parcel_status THEN
    RAISE EXCEPTION 'parcel_terminal';
  END IF;

  SELECT id, user_id INTO v_student_id, v_user_id
  FROM public.students
  WHERE member_id = v_member;

  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  UPDATE public.parcels p
  SET member_id  = v_member,
      student_id = v_student_id,
      user_id    = v_user_id,
      updated_at = now()
  WHERE p.id = p_parcel_id
  RETURNING p.* INTO result;

  -- Status didn't change so the trigger stays silent — record the correction
  -- on the timeline explicitly.
  INSERT INTO public.parcel_events
    (parcel_id, from_status, to_status, actor_user_id, actor_role, note, payload)
  VALUES (
    p_parcel_id, v_cur_status, v_cur_status, p_actor_user_id, 'admin',
    '重新指派学生：' || COALESCE(v_old_member, '—') || ' → ' || v_member
      || CASE WHEN v_student_id IS NULL THEN '（未匹配到 students 档案）' ELSE '' END,
    jsonb_build_object(
      'reassign', true,
      'from_member_id', v_old_member,
      'to_member_id', v_member,
      'linked_student_id', v_student_id
    )
  );

  RETURN jsonb_build_object(
    'parcel', to_jsonb(result),
    'linked', v_student_id IS NOT NULL,
    'prior_member_id', v_old_member
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reassign_parcel_student(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
