-- Pickup-desk integrity (2026-07-03 shipping refinement, SR-2; decisions D1/D3).
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS); the only data touched is
-- re-randomizing pickup_token on colliding rows (see 3). NOT YET APPLIED TO
-- PROD.
--
-- WHY
-- ───
-- 1. D1 — student_confirm_pickup was the weakest path to the terminal
--    picked_up state: any owner could one-tap flip arrived_us -> picked_up
--    from uscbia.com with no pickup window, no payment check, and no desk
--    presence — directly contradicting the pickup-token migration's rationale
--    ("a parcel can't be marked picked_up without presenting its code").
--    Fix: the parent shipment must be pickup_open AND any recorded amount owed
--    must be paid. Officer desk paths are unaffected (they have the token /
--    the parcel detail page).
-- 2. D3 — a wrong desk confirm had NO sanctioned undo: picked_up is terminal,
--    so every mis-scan became a run-SQL-in-prod incident invisible to the
--    audit log. Fix: admin_revert_pickup (picked_up -> arrived_us, requires a
--    reason, service-role only; the route gates it to super_admin). The
--    parcel_events row comes from the existing log_parcel_status_change
--    trigger; we then stamp the reason onto that row so the timeline shows it.
-- 3. pickup_token was a non-unique 8-char md5 substring with no index, and
--    /pickup/verify resolves the parcel BY token — a collision could confirm
--    the WRONG student's parcel (birthday-paradox: ~1% at 10k rows), and every
--    desk lookup was a seq scan. Fix: dedupe existing collisions, add a UNIQUE
--    index, and keep future inserts unique via a BEFORE INSERT trigger
--    (SECURITY DEFINER so RLS'd student inserts still see all rows for the
--    collision check). Also index tracking_cn (bulk-intake match lookup).

-- ─────────────────────────────────────────────────────────────────────────
-- 1 — D1: gate student self-confirm on window open + payment settled.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.student_confirm_pickup(p_parcel_id uuid)
RETURNS public.parcels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_cur         public.parcel_status;
  v_shipment_id uuid;
  v_owed        integer;
  v_paid_at     timestamptz;
  v_ship_status text;
  result        public.parcels;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Ownership + current status, locked for the transition.
  SELECT status, shipment_id, amount_owed_cents, paid_at
  INTO v_cur, v_shipment_id, v_owed, v_paid_at
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

  -- D1: self-confirm only while the batch's pickup window is actually open.
  IF v_shipment_id IS NOT NULL THEN
    SELECT status INTO v_ship_status
    FROM public.shipments WHERE id = v_shipment_id;
  END IF;
  IF v_ship_status IS DISTINCT FROM 'pickup_open' THEN
    RAISE EXCEPTION 'pickup_not_open';
  END IF;

  -- D1: a recorded amount owed must be settled before self-confirm.
  IF v_owed IS NOT NULL AND v_owed > 0 AND v_paid_at IS NULL THEN
    RAISE EXCEPTION 'payment_required';
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

REVOKE ALL ON FUNCTION public.student_confirm_pickup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_confirm_pickup(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2 — D3: sanctioned pickup revert (super_admin-only at the route).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revert_pickup(
  p_parcel_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
RETURNS public.parcels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur  public.parcel_status;
  result public.parcels;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 2 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT status INTO v_cur
  FROM public.parcels
  WHERE id = p_parcel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_cur <> 'picked_up'::public.parcel_status THEN
    RAISE EXCEPTION 'not_picked_up';
  END IF;

  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  UPDATE public.parcels p
  SET status = 'arrived_us'::public.parcel_status, updated_at = now()
  WHERE p.id = p_parcel_id
  RETURNING p.* INTO result;

  -- The log_parcel_status_change trigger just wrote the picked_up->arrived_us
  -- event (same txn); stamp the officer's reason onto it so the timeline
  -- explains the revert.
  UPDATE public.parcel_events
  SET note    = '撤销取件：' || btrim(p_reason),
      payload = COALESCE(payload, '{}'::jsonb)
                || jsonb_build_object('pickup_revert', true)
  WHERE id = (
    SELECT id FROM public.parcel_events
    WHERE parcel_id = p_parcel_id
      AND to_status = 'arrived_us'::public.parcel_status
    ORDER BY created_at DESC
    LIMIT 1
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revert_pickup(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3 — pickup_token: dedupe, then enforce uniqueness (index + insert trigger),
--     and index the two hot desk lookups.
-- ─────────────────────────────────────────────────────────────────────────

-- Re-randomize the newer row of any colliding pair until no duplicates remain.
-- (Loop converges immediately in practice — 16^8 ≈ 4.3B token space.) Affected
-- students see a fresh code on their parcel page; the old QR simply re-renders.
DO $$
DECLARE
  v_dupes int;
BEGIN
  LOOP
    UPDATE public.parcels p
    SET pickup_token = substr(md5(gen_random_uuid()::text), 1, 8),
        updated_at   = now()
    WHERE EXISTS (
      SELECT 1 FROM public.parcels q
      WHERE q.pickup_token = p.pickup_token
        AND q.id < p.id
    );
    GET DIAGNOSTICS v_dupes = ROW_COUNT;
    EXIT WHEN v_dupes = 0;
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS parcels_pickup_token_key
  ON public.parcels (pickup_token);

-- Keep future inserts collision-free regardless of the inserting path
-- (officer API, student RLS insert on uscbia.com, manual SQL). SECURITY
-- DEFINER so the EXISTS check sees all rows past RLS — same rationale as
-- enforce_one_open_pack_request (Codex #5). The unique index stays as the
-- hard backstop for the (negligible) concurrent-insert window.
CREATE OR REPLACE FUNCTION public.ensure_unique_pickup_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.pickup_token IS NULL THEN
    NEW.pickup_token := substr(md5(gen_random_uuid()::text), 1, 8);
  END IF;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.parcels WHERE pickup_token = NEW.pickup_token
    );
    NEW.pickup_token := substr(md5(gen_random_uuid()::text), 1, 8);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_parcels_unique_pickup_token ON public.parcels;
CREATE TRIGGER trg_parcels_unique_pickup_token
  BEFORE INSERT ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.ensure_unique_pickup_token();

CREATE INDEX IF NOT EXISTS parcels_tracking_cn_idx
  ON public.parcels (tracking_cn);
