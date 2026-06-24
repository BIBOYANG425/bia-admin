-- Harden the shipping RPCs/trigger per the 2026-06-24 Codex adversarial review.
-- Fixes findings #7, #8 (advance-parcels), #2, #3 (attach race), #5 (trigger).
-- All CREATE OR REPLACE / idempotent; no data touched. REQUIRES APPLY TO PROD.
-- (Codex #6 was a false positive — pack_request_parcels already has
-- PRIMARY KEY (request_id, parcel_id), so duplicate links are impossible.)

-- ─────────────────────────────────────────────────────────────────────────
-- #7 + #8 — admin_advance_parcels: always protect the terminal state, and make
-- branch-state targets actually move parcels.
--   #8: bulk-advancing a flight to lost/returned/disputed under the default
--       only_forward=true used to update ZERO rows (v_target_idx = -1 killed the
--       WHERE) — a silent no-op regression vs the old per-parcel loop.
--   #7: only_forward=false updated EVERY non-target parcel with no guard, so it
--       could drag a delivered (picked_up) parcel backward.
-- New rule: never touch picked_up (only truly-irreversible state); a branch
-- target marks every non-delivered parcel; a happy target respects only_forward.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_advance_parcels(
  p_shipment_id uuid,
  p_target text,
  p_only_forward boolean,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target     public.parcel_status := p_target::public.parcel_status;
  v_target_idx int;
  v_total      int;
  v_updated    int;
BEGIN
  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  v_target_idx := CASE v_target
    WHEN 'expected'    THEN 0
    WHEN 'received_cn' THEN 1
    WHEN 'in_transit'  THEN 2
    WHEN 'arrived_us'  THEN 3
    WHEN 'picked_up'   THEN 4
    ELSE -1   -- lost / returned / disputed (branch states)
  END;

  SELECT count(*) INTO v_total
  FROM public.parcels WHERE shipment_id = p_shipment_id;

  UPDATE public.parcels p
  SET status      = v_target,
      updated_at  = now(),
      received_at = CASE
                      WHEN v_target = 'received_cn' AND p.received_at IS NULL
                      THEN now() ELSE p.received_at END
  WHERE p.shipment_id = p_shipment_id
    AND p.status <> v_target
    -- Terminal protection (#7): never move a delivered parcel, even with
    -- only_forward=false. picked_up is the only irreversible parcel state;
    -- lost/returned/disputed are reversible exception states.
    AND p.status <> 'picked_up'::public.parcel_status
    AND (
      -- Branch-state target → mark every non-delivered parcel (#8).
      v_target_idx = -1
      -- Explicit backward override → any non-delivered parcel.
      OR NOT p_only_forward
      -- Forward-only happy path → only parcels earlier than the target.
      OR (CASE p.status
            WHEN 'expected'    THEN 0
            WHEN 'received_cn' THEN 1
            WHEN 'in_transit'  THEN 2
            WHEN 'arrived_us'  THEN 3
            WHEN 'picked_up'   THEN 4
            ELSE -1 END) BETWEEN 0 AND v_target_idx - 1
    );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'total', v_total,
    'updated', v_updated,
    'skipped', v_total - v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_advance_parcels(uuid, text, boolean, uuid)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- #2 + #3 — admin_attach_pack_request: lock the request row + re-check request
-- AND shipment status INSIDE the transaction. The route prechecks these, but a
-- concurrent attach / status change between precheck and RPC could (a) attach to
-- a departed/archived shipment, (b) resurrect a closed request to 'approved', or
-- (c) let two concurrent attaches overwrite shipment_id. SELECT ... FOR UPDATE
-- serialises concurrent attaches of the same request; the re-checks reject the
-- loser cleanly (route maps the tokens to 409/404).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_attach_pack_request(
  p_request_id uuid,
  p_shipment_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req_status  text;
  v_ship_status text;
  v_parcel_ids  uuid[];
  v_total       int;
  v_attached    int;
BEGIN
  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  -- Lock the request row, then re-validate inside the txn (closes the
  -- precheck→RPC race for #2/#3).
  SELECT status INTO v_req_status
  FROM public.pack_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req_status IS NULL THEN
    RAISE EXCEPTION 'pack_request_not_found';
  END IF;
  IF v_req_status NOT IN ('pending', 'contacted') THEN
    RAISE EXCEPTION 'pack_request_not_attachable: %', v_req_status;
  END IF;

  SELECT status INTO v_ship_status
  FROM public.shipments WHERE id = p_shipment_id;
  IF v_ship_status IS NULL OR v_ship_status NOT IN ('forming', 'sealed') THEN
    RAISE EXCEPTION 'shipment_not_attachable: %', COALESCE(v_ship_status, 'missing');
  END IF;

  SELECT array_agg(parcel_id) INTO v_parcel_ids
  FROM public.pack_request_parcels WHERE request_id = p_request_id;
  v_total := COALESCE(array_length(v_parcel_ids, 1), 0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('total', 0, 'attached', 0, 'request', NULL);
  END IF;

  v_attached := public.admin_attach_parcels_to_shipment(
    v_parcel_ids, p_shipment_id, p_actor_user_id
  );

  UPDATE public.pack_requests
  SET shipment_id = p_shipment_id,
      status      = 'approved'
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'total', v_total,
    'attached', v_attached,
    'request', (SELECT to_jsonb(pr) FROM public.pack_requests pr WHERE pr.id = p_request_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_attach_pack_request(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- #5 — enforce_one_open_pack_request: run as SECURITY DEFINER so the EXISTS
-- check sees ALL rows regardless of the inserting role's RLS. (Low real-world
-- impact since parcels are single-owner, but makes the invariant robust if the
-- insert path ever runs under a more-restricted role.)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_one_open_pack_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.parcel_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.pack_request_parcels prp
    JOIN public.pack_requests pr ON pr.id = prp.request_id
    WHERE prp.parcel_id = NEW.parcel_id
      AND prp.request_id <> NEW.request_id
      AND pr.status IN ('pending', 'contacted', 'approved')
  ) THEN
    RAISE EXCEPTION
      'parcel % is already in an open pack request', NEW.parcel_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;
