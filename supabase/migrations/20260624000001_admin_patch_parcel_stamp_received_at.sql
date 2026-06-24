-- Auto-stamp parcels.received_at when a parcel is marked received_cn.
--
-- WHY
-- ───
-- received_at is only populated by callers that remember to pass it: the admin
-- parcel-detail PAGE stamps it client-side, and the bulk-receive route stamps
-- it explicitly. But a direct API write through PATCH /parcels/[id] (or the
-- advance-parcels bulk path, or any direct admin_patch_parcel call) that flips
-- status to 'received_cn' WITHOUT a received_at leaves the column NULL — so the
-- warehouse intake time is lost and "received N days ago" displays / ETA logic
-- silently break. (2026-06-23 test pass, parcels MEDIUM #2.)
--
-- FIX
-- ───
-- Stamp received_at = now() inside admin_patch_parcel when the patch sets status
-- to 'received_cn' and received_at is still NULL — covering every caller in one
-- place. An explicit received_at in the patch still wins, and an already-set
-- received_at is never overwritten (re-PATCH is safe).
--
-- SAFETY
-- ──────
-- * CREATE OR REPLACE only — identical signature/return; the function body is
--   byte-for-byte the live one (bia-roommate 20260423_admin_parcel_rpcs.sql)
--   except the single `received_at` CASE gains one WHEN branch. No data touched.
-- * All SET expressions read the OLD row (p.received_at, p.status), so the guard
--   "p.received_at IS NULL" correctly checks the pre-update value.
-- * Append-only; supersedes the prior body via CREATE OR REPLACE.

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
  result public.parcels;
BEGIN
  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

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
    shipment_id  = CASE WHEN p_patch ? 'shipment_id'
                        THEN NULLIF(p_patch->>'shipment_id','')::uuid
                        ELSE p.shipment_id END,
    updated_at   = now()
  WHERE p.id = p_id
  RETURNING p.* INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_patch_parcel(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
