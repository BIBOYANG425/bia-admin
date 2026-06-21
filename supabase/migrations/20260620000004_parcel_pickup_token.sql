-- Per-parcel pickup token + officer scan-to-verify RPC.
-- (Phase B · M4 · backs the student QR + the admin 扫码核销 scanner.)
--
-- ⚠️ DRAFT — NOT YET APPLIED. Apply on a Supabase preview branch first.
--
-- WHY: at pickup the student shows a QR encoding parcel_id + pickup_token; the
-- officer scans it and the parcel is confirmed picked_up with on-site identity
-- verification (actor_role='admin'). The token makes the scan unforgeable —
-- a parcel can't be marked picked_up without presenting its code.
--
-- SAFETY:
-- * pickup_token has a volatile default (gen_random_uuid-derived), so adding
--   the column backfills a DISTINCT 8-char code per existing row. Small table,
--   one-time rewrite. No uniqueness needed: the verify RPC matches token AND
--   parcel_id together.
-- * Token is officer-only via service-role + self-read by the owning student
--   (existing parcels self-read RLS). No anon exposure.
-- * The verify RPC is service-role-only (admin API), like admin_patch_parcel.

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS pickup_token text
    NOT NULL DEFAULT substr(md5(gen_random_uuid()::text), 1, 8);

CREATE OR REPLACE FUNCTION public.admin_confirm_pickup_by_token(
  p_parcel_id uuid,
  p_token text,
  p_actor_user_id uuid
)
RETURNS public.parcels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur   public.parcel_status;
  v_token text;
  result  public.parcels;
BEGIN
  SELECT status, pickup_token INTO v_cur, v_token
  FROM public.parcels
  WHERE id = p_parcel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_token IS NULL OR v_token <> p_token THEN
    RAISE EXCEPTION 'bad_token';
  END IF;

  -- Idempotent: already picked up → return current row.
  IF v_cur = 'picked_up'::public.parcel_status THEN
    SELECT p.* INTO result FROM public.parcels p WHERE p.id = p_parcel_id;
    RETURN result;
  END IF;
  IF v_cur <> 'arrived_us'::public.parcel_status THEN
    RAISE EXCEPTION 'not_pickup_eligible';
  END IF;

  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  UPDATE public.parcels p
  SET status = 'picked_up'::public.parcel_status, updated_at = now()
  WHERE p.id = p_parcel_id
  RETURNING p.* INTO result;

  RETURN result;
END;
$$;

-- Service-role only (called from the admin scan endpoint), like the other
-- admin_* parcel RPCs.
REVOKE ALL ON FUNCTION public.admin_confirm_pickup_by_token(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
