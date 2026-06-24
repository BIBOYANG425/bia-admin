-- Atomic pack-request attach: move the parcels AND approve the request in one txn.
--
-- WHY
-- ───
-- The /pack-requests/[id]/attach route did two separate DB writes: the
-- admin_attach_parcels_to_shipment RPC (move parcels) THEN an UPDATE marking the
-- pack request approved + linked. If the second failed after the first, the
-- parcels were attached but the request stayed unapproved with no rollback —
-- an inconsistent state. (2026-06-23 test pass, requests MEDIUM #12.)
--
-- FIX
-- ───
-- A single SECURITY DEFINER function does both writes; a plpgsql function body
-- is one transaction, so either both land or neither does. It reuses
-- admin_attach_parcels_to_shipment for the parcel move (which already restricts
-- to status='received_cn' and stamps actor_role='admin'), then approves the
-- request. Returns { total, attached, request } as jsonb.
--
-- SAFETY: additive (new function); no existing object changed; no data touched.

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
  v_parcel_ids uuid[];
  v_total int;
  v_attached int;
BEGIN
  SELECT array_agg(parcel_id) INTO v_parcel_ids
  FROM public.pack_request_parcels
  WHERE request_id = p_request_id;

  v_total := COALESCE(array_length(v_parcel_ids, 1), 0);
  IF v_total = 0 THEN
    -- Nothing to attach: do NOT approve an empty request.
    RETURN jsonb_build_object('total', 0, 'attached', 0, 'request', NULL);
  END IF;

  -- Move eligible (received_cn) parcels onto the shipment (received_cn ->
  -- in_transit, actor GUCs + audit). Reused so the eligibility rule stays in
  -- one place.
  v_attached := public.admin_attach_parcels_to_shipment(
    v_parcel_ids, p_shipment_id, p_actor_user_id
  );

  -- Approve + link the request in the SAME transaction.
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
