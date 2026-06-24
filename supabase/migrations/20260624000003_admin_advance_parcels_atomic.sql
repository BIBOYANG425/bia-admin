-- Atomic bulk parcel-advance for a shipment (one transaction).
--
-- WHY
-- ───
-- /shipments/[id]/advance-parcels looped over the flight's parcels calling
-- admin_patch_parcel once each — N sequential RPC round-trips, NOT in one
-- transaction. A mid-batch failure left the flight half-advanced with a partial
-- notification enqueue and no rollback. (2026-06-23 test pass, shipments
-- MEDIUM #6.)
--
-- FIX
-- ───
-- One SECURITY DEFINER function advances all eligible parcels in a single bulk
-- UPDATE (one transaction). It reproduces the route's skip rules:
--   • skip parcels already AT the target,
--   • forward-only (default): skip parcels off the happy path (branch states
--     lost/returned/disputed) or already at/past the target.
-- The actor GUCs are set once, so the log_parcel_status_change +
-- enqueue_parcel_notification AFTER-UPDATE triggers fire for every advanced row
-- exactly as the per-parcel path did. received_at is stamped on a transition to
-- received_cn (matching admin_patch_parcel). Returns { total, updated, skipped }.
--
-- SAFETY: additive (new function); no existing object/data changed.

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

  -- Happy-path index (explicit, not enum-ordinal, so it can't drift); branch
  -- / unknown statuses → -1.
  v_target_idx := CASE v_target
    WHEN 'expected'    THEN 0
    WHEN 'received_cn' THEN 1
    WHEN 'in_transit'  THEN 2
    WHEN 'arrived_us'  THEN 3
    WHEN 'picked_up'   THEN 4
    ELSE -1
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
    AND (
      NOT p_only_forward
      OR (
        v_target_idx >= 0
        AND (CASE p.status
               WHEN 'expected'    THEN 0
               WHEN 'received_cn' THEN 1
               WHEN 'in_transit'  THEN 2
               WHEN 'arrived_us'  THEN 3
               WHEN 'picked_up'   THEN 4
               ELSE -1 END) BETWEEN 0 AND v_target_idx - 1
      )
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
