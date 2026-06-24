-- Enforce: a parcel can be in at most ONE open pack request (race-free).
--
-- WHY
-- ───
-- The student "create pack request" route (bia-roommate
-- app/api/shipping/pack-requests/route.ts) checks that none of the chosen
-- parcels are already in an open pack request (status pending/contacted/approved)
-- and then inserts the links — a check-then-insert TOCTOU race: two concurrent
-- requests can both pass the check and both attach the same parcel. (2026-06-23
-- test pass, requests MEDIUM #7.)
--
-- FIX
-- ───
-- A BEFORE INSERT trigger on pack_request_parcels enforces the invariant in the
-- DB. A transaction-scoped advisory lock keyed by the parcel id serialises
-- concurrent inserts for the SAME parcel, so the EXISTS check below is evaluated
-- against committed state and the race is closed. The app-level check stays as
-- the friendly fast path (returns 409 in the common, non-racing case); this
-- trigger is the backstop and only fires on an actual race.
--
-- "Open" = pending / contacted / approved, matching OPEN_STATUSES in the route.
-- Raised as unique_violation (23505) so callers can treat it like a constraint.
--
-- SAFETY: additive. No existing rows are touched; the trigger only guards future
-- INSERTs. If current data already violates the invariant the trigger does NOT
-- retroactively reject it (only new inserts), so applying this can never error.

CREATE OR REPLACE FUNCTION public.enforce_one_open_pack_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Serialise concurrent inserts of the same parcel (TOCTOU guard). Held until
  -- the transaction ends.
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

DROP TRIGGER IF EXISTS trg_one_open_pack_request ON public.pack_request_parcels;
CREATE TRIGGER trg_one_open_pack_request
  BEFORE INSERT ON public.pack_request_parcels
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_one_open_pack_request();
