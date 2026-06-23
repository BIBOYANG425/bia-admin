-- Guard admin_attach_parcels_to_shipment against moving non-eligible parcels.
--
-- WHY
-- ───
-- The original RPC (bia-roommate 20260423_admin_parcel_rpcs.sql:57-84) ran:
--   UPDATE parcels
--   SET shipment_id = p_shipment_id,
--       status = CASE WHEN status='received_cn' THEN 'in_transit' ELSE status END
--   WHERE id = ANY(p_parcel_ids)
-- i.e. it overwrote shipment_id with NO status filter. So attaching a parcel
-- that was already in_transit / arrived_us / picked_up / lost / returned /
-- disputed — e.g. a stale or duplicate pack-request re-attach, or a parcel
-- already shipped in another batch — silently re-pointed its shipment_id to the
-- new batch while keeping its advanced status. That corrupts BOTH batches'
-- manifests and the public /api/shipping/history aggregates, and effectively
-- moves a delivered parcel backward onto a new shipment.
--
-- FIX
-- ───
-- Only attach parcels that are actually eligible to be shipped, i.e.
-- status = 'received_cn' (warehouse has them, not yet on an international leg).
-- Those are exactly the parcels the attach UI is meant to batch; anything past
-- received_cn keeps its shipment_id and status untouched. The function still
-- RETURNS the count of rows actually updated, so callers can detect and surface
-- skipped (ineligible) parcels.
--
-- SAFETY
-- ──────
-- * CREATE OR REPLACE only — same name, same signature, same return type (int).
-- * No data migration; no row is touched by applying this.
-- * Eligible (received_cn) attaches behave EXACTLY as before
--   (received_cn -> in_transit, shipment_id set, actor_role='admin' event).
-- * Append-only per repo guardrails — this supersedes the prior body via
--   CREATE OR REPLACE; the earlier definition is left in history.

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
  updated_count int;
BEGIN
  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

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
