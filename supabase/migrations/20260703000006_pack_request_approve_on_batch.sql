-- Fix admin_attach_pack_request's approval predicate (found by the SR-4
-- integration suite while pinning 20260703000001's behavior).
--
-- WHY
-- ───
-- 20260703000001 approves only when v_attached = v_total, where v_attached
-- counts parcels NEWLY moved by THIS call. On the intended re-run flow
-- (partial attach → remaining parcels received → attach again) the second
-- call only moves the stragglers (attached < total), so the request could
-- never reach 'approved' — the exact stranding the change set out to fix,
-- one step later.
--
-- FIX
-- ───
-- Approve when every linked parcel is ON this shipment after the attach,
-- regardless of which call moved it. `attached` in the return value still
-- counts newly-moved parcels (the officer's toast shows real work done).
--
-- SAFETY
-- ──────
-- CREATE OR REPLACE only; same signature/return shape. 20260703000001 has
-- NOT been applied to prod yet — apply both in order (this supersedes the
-- body). Append-only per repo guardrails.

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
  v_on_batch    int;
BEGIN
  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  -- Lock the request row, then re-validate inside the txn (closes the
  -- precheck→RPC race for Codex #2/#3).
  SELECT status INTO v_req_status
  FROM public.pack_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req_status IS NULL THEN
    RAISE EXCEPTION 'pack_request_not_found';
  END IF;
  IF v_req_status NOT IN ('pending', 'contacted') THEN
    RAISE EXCEPTION 'pack_request_not_attachable: %', v_req_status;
  END IF;

  -- Shipment eligibility is checked (and the row locked) inside
  -- admin_attach_parcels_to_shipment; the early check here just fails fast
  -- before we aggregate parcel ids.
  SELECT status INTO v_ship_status
  FROM public.shipments WHERE id = p_shipment_id;
  IF v_ship_status IS NULL OR v_ship_status NOT IN ('forming', 'sealed') THEN
    RAISE EXCEPTION 'shipment_not_attachable: %', COALESCE(v_ship_status, 'missing');
  END IF;

  SELECT array_agg(parcel_id) INTO v_parcel_ids
  FROM public.pack_request_parcels WHERE request_id = p_request_id;
  v_total := COALESCE(array_length(v_parcel_ids, 1), 0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'total', 0, 'attached', 0, 'approved', false, 'request', NULL);
  END IF;

  v_attached := public.admin_attach_parcels_to_shipment(
    v_parcel_ids, p_shipment_id, p_actor_user_id
  );

  -- Approval predicate: every linked parcel sits on THIS shipment now —
  -- whether this call moved it or an earlier partial attach did.
  SELECT count(*) INTO v_on_batch
  FROM public.parcels
  WHERE id = ANY(v_parcel_ids)
    AND shipment_id = p_shipment_id;

  IF v_on_batch = v_total THEN
    UPDATE public.pack_requests
    SET shipment_id = p_shipment_id,
        status      = 'approved'
    WHERE id = p_request_id;
  ELSIF v_attached > 0 THEN
    -- Partial: remember where the attached parcels went, but keep the request
    -- attachable so the rest can follow after intake.
    UPDATE public.pack_requests
    SET shipment_id = p_shipment_id
    WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'total', v_total,
    'attached', v_attached,
    'approved', v_on_batch = v_total,
    'request', (SELECT to_jsonb(pr) FROM public.pack_requests pr WHERE pr.id = p_request_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_attach_pack_request(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
