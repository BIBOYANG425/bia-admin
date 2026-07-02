-- Shipping state-machine hardening (2026-07-03 shipping refinement, SR-1).
-- Closes the three DB races the 06-24 hardening pass didn't reach, plus the
-- partial-attach-still-approves bug. All CREATE OR REPLACE / idempotent; no
-- data touched. REQUIRES APPLY TO PROD (route code degrades gracefully until
-- applied: the route-level prechecks keep working, these are the in-txn
-- backstops).
--
-- WHY (per finding)
-- ─────────────────
-- 1. admin_patch_parcel was read-then-write with no in-RPC guard: the route
--    runs checkTransition on a snapshot, then the RPC applies status
--    unconditionally. A concurrent pickup-desk confirm could be RESURRECTED
--    by an in-flight PATCH (picked_up → in_transit), violating the terminal
--    invariant that admin_advance_parcels and both pickup RPCs protect.
--    Fix: FOR UPDATE + re-run the transition policy inside the transaction.
-- 2. admin_patch_parcel accepted shipment_id — a status-less PATCH
--    {shipment_id: X} bypassed every attach guard (could attach an 'expected'
--    parcel to an archived shipment, re-point a picked_up parcel, or silently
--    detach). No caller in any repo sends it (verified 2026-07-03); the attach
--    flow owns shipment_id. Fix: RAISE on the key; the route zod also drops it.
-- 3. admin_attach_parcels_to_shipment never re-checked the shipment inside the
--    transaction — the precheck→RPC race PR #49 fixed for pack-requests was
--    still open on the direct attach path (concurrent seal/depart could land
--    parcels on a departed batch). Fix: lock the shipment row FOR UPDATE +
--    re-check forming/sealed in-txn. Locking here also covers the
--    pack-request path (it calls this function).
-- 4. admin_attach_pack_request flipped the request to 'approved' even when
--    v_attached < v_total (including 0!) — skipped parcels were stranded:
--    'approved' is outside ATTACHABLE_REQUEST_STATUS and the transition policy
--    forbids reopening. Fix: only approve when every parcel attached; a
--    partial attach records shipment_id but keeps the request re-attachable.
--
-- TRANSITION POLICY (mirror of bia-admin/lib/shipping/transitions.ts)
-- ────────────────────────────────────────────────────────────────────
--   • same → same                          allowed (field-only edits)
--   • picked_up → disputed                 allowed (sanctioned contest path,
--                                          decision D3 2026-07-03)
--   • picked_up → anything else            REJECTED (terminal)
--   • into / out of lost/returned/disputed allowed (branch states)
--   • forward, or one step back            allowed
--   • two-or-more steps back               REJECTED
--
-- SAFETY
-- ──────
-- * CREATE OR REPLACE only — same signatures; admin_attach_pack_request keeps
--   its jsonb return shape and gains an 'approved' key (additive; the route
--   computes approved from counts for pre-apply compatibility).
-- * All guards RAISE recognizable tokens the routes map to 4xx:
--   parcel_terminal / invalid_transition / shipment_id_not_patchable /
--   shipment_not_attachable.
-- * Append-only; supersedes prior bodies via CREATE OR REPLACE.

-- ─────────────────────────────────────────────────────────────────────────
-- 1 + 2 — admin_patch_parcel: row lock + in-txn transition policy; reject
-- shipment_id patches.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_patch_parcel(
  p_id uuid,
  p_actor_user_id uuid,
  p_patch jsonb
)
RETURNS public.parcels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur    public.parcel_status;
  v_new    public.parcel_status;
  v_fi     int;
  v_ti     int;
  result   public.parcels;
BEGIN
  IF p_patch ? 'shipment_id' THEN
    RAISE EXCEPTION 'shipment_id_not_patchable';
  END IF;

  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  -- Lock the row so the transition check below and the UPDATE are atomic
  -- w.r.t. concurrent confirms/advances (closes the picked_up-resurrection
  -- race).
  SELECT status INTO v_cur
  FROM public.parcels
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;  -- route maps a NULL result to 404, as before
  END IF;

  IF p_patch ? 'status' THEN
    v_new := (p_patch->>'status')::public.parcel_status;
    IF v_new IS DISTINCT FROM v_cur THEN
      -- Terminal: picked_up only leaves via the sanctioned contest path.
      IF v_cur = 'picked_up'::public.parcel_status
         AND v_new <> 'disputed'::public.parcel_status THEN
        RAISE EXCEPTION 'parcel_terminal: picked_up -> %', v_new;
      END IF;
      -- Branch states enter/exit freely from any non-terminal state.
      IF v_cur NOT IN ('lost', 'returned', 'disputed', 'picked_up')
         AND v_new NOT IN ('lost', 'returned', 'disputed') THEN
        v_fi := CASE v_cur
          WHEN 'expected'    THEN 0
          WHEN 'received_cn' THEN 1
          WHEN 'in_transit'  THEN 2
          WHEN 'arrived_us'  THEN 3
          WHEN 'picked_up'   THEN 4
        END;
        v_ti := CASE v_new
          WHEN 'expected'    THEN 0
          WHEN 'received_cn' THEN 1
          WHEN 'in_transit'  THEN 2
          WHEN 'arrived_us'  THEN 3
          WHEN 'picked_up'   THEN 4
        END;
        -- Forward or one step back only.
        IF v_ti < v_fi - 1 THEN
          RAISE EXCEPTION 'invalid_transition: % -> %', v_cur, v_new;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.parcels p
  SET
    status       = COALESCE((p_patch->>'status')::public.parcel_status, p.status),
    weight_grams = CASE WHEN p_patch ? 'weight_grams'
                        THEN NULLIF(p_patch->>'weight_grams','')::int
                        ELSE p.weight_grams END,
    dim_cm_l     = CASE WHEN p_patch ? 'dim_cm_l'
                        THEN NULLIF(p_patch->>'dim_cm_l','')::numeric
                        ELSE p.dim_cm_l END,
    dim_cm_w     = CASE WHEN p_patch ? 'dim_cm_w'
                        THEN NULLIF(p_patch->>'dim_cm_w','')::numeric
                        ELSE p.dim_cm_w END,
    dim_cm_h     = CASE WHEN p_patch ? 'dim_cm_h'
                        THEN NULLIF(p_patch->>'dim_cm_h','')::numeric
                        ELSE p.dim_cm_h END,
    notes        = CASE WHEN p_patch ? 'notes'
                        THEN NULLIF(p_patch->>'notes','')
                        ELSE p.notes END,
    received_at  = CASE
                     WHEN p_patch ? 'received_at'
                       THEN NULLIF(p_patch->>'received_at','')::timestamptz
                     WHEN (p_patch->>'status') = 'received_cn' AND p.received_at IS NULL
                       THEN now()
                     ELSE p.received_at
                   END,
    updated_at   = now()
  WHERE p.id = p_id
  RETURNING p.* INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_patch_parcel(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3 — admin_attach_parcels_to_shipment: lock + re-check the shipment in-txn.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_attach_parcels_to_shipment(
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

  -- Lock the shipment row: a concurrent seal/depart PATCH waits for us (or we
  -- see its committed status), so parcels can never land on a departed batch.
  SELECT status INTO v_ship_status
  FROM public.shipments
  WHERE id = p_shipment_id
  FOR UPDATE;

  IF v_ship_status IS NULL OR v_ship_status NOT IN ('forming', 'sealed') THEN
    RAISE EXCEPTION 'shipment_not_attachable: %', COALESCE(v_ship_status, 'missing');
  END IF;

  -- Only received_cn parcels are eligible to be attached + advanced. Parcels in
  -- any later or terminal state are left untouched: no shipment_id overwrite,
  -- no backward status move.
  UPDATE public.parcels
  SET shipment_id = p_shipment_id,
      status      = 'in_transit'::public.parcel_status,
      updated_at  = now()
  WHERE id = ANY(p_parcel_ids)
    AND status = 'received_cn'::public.parcel_status;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_attach_parcels_to_shipment(uuid[], uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4 — admin_attach_pack_request: only approve a FULLY attached request. A
-- partial attach records shipment_id (where the attached parcels went) but
-- keeps the request in its attachable state so the officer can re-run the
-- attach once the remaining parcels are received_cn.
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

  IF v_attached = v_total THEN
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
    'approved', v_attached = v_total,
    'request', (SELECT to_jsonb(pr) FROM public.pack_requests pr WHERE pr.id = p_request_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_attach_pack_request(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
