-- Widen shipping_notifications.kind CHECK to cover branch-state kinds
-- (Retention roadmap · Phase 1a · follow-up to 20260606061351)
--
-- WHY
-- ───
-- The branch-states migration (20260606061351_parcel_notification_enqueue_
-- branch_states.sql) extended enqueue_parcel_notification() to INSERT kinds
-- 'lost' / 'returned' / 'disputed' into public.shipping_notifications. But the
-- kind CHECK constraint — defined inline at table creation in bia-roommate's
-- 20260419_shipping.sql — only allows the original 7 kinds:
--   received_cn, in_transit, arrived_us,
--   pickup_open, pickup_reminder, picked_up_thanks, orphan_received
-- No migration ever widened it. Because the producer is an AFTER-UPDATE
-- trigger inside the officer's UPDATE transaction, a check_violation raised
-- by the INSERT aborts the whole parcel UPDATE: if the 7-kind function body
-- is live, marking a parcel lost / returned / disputed fails with a hard 500.
--
-- SAFETY
-- ──────
-- * Widening only. Every existing row's kind is one of the original 7, which
--   remain in the new list, so ADD CONSTRAINT validates without rewrites and
--   no row can be orphaned. No data is touched.
-- * Safe under BOTH possible live states of the trigger function:
--   - 7-kind body live (branch-states migration applied): this fixes the
--     officer-facing abort on lost/returned/disputed.
--   - 4-kind body live (only the base 20260606061321 applied): the trigger
--     never emits the new kinds; widening is inert until the 7-kind body
--     lands.
-- * Constraint name: the inline column CHECK in 20260419_shipping.sql is
--   unnamed, so Postgres auto-named it shipping_notifications_kind_check
--   (<table>_<column>_check). DROP ... IF EXISTS keeps this idempotent.
--
-- VERIFICATION (read-only — run in the Supabase SQL editor / dashboard to
-- confirm which state prod is actually in, before and after applying):
--
--   -- Which function body is live? (look for 'lost'/'returned'/'disputed')
--   select pg_get_functiondef(oid) from pg_proc where proname='enqueue_parcel_notification';
--
--   -- Current CHECK constraints on the table (confirm the kind list + name)
--   select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.shipping_notifications'::regclass and contype='c';
--
--   -- Queue health snapshot
--   select status, count(*) from public.shipping_notifications group by 1;

-- Single statement: DROP + ADD in one ALTER TABLE so the swap is atomic even
-- if the migration runner autocommits per statement — there is no window
-- where the table has no kind CHECK, and a failure leaves the old constraint
-- in place untouched.
ALTER TABLE public.shipping_notifications
  DROP CONSTRAINT IF EXISTS shipping_notifications_kind_check,
  ADD CONSTRAINT shipping_notifications_kind_check CHECK (kind IN (
    'received_cn', 'in_transit', 'arrived_us',
    'pickup_open', 'pickup_reminder', 'picked_up_thanks',
    'orphan_received',
    'lost', 'returned', 'disputed'
  ));

-- Post-condition assertions: fail LOUDLY if the widening did not take effect.
-- Guards against the constraint-name assumption above being wrong in prod
-- (e.g. the live narrow CHECK carries a different auto-generated name, so the
-- DROP IF EXISTS matched nothing and a second, narrower CHECK now coexists —
-- which would keep aborting officer updates while this migration "succeeded").
DO $$
DECLARE
  kind_attnum  smallint;
  check_count  integer;
  check_def    text;
BEGIN
  SELECT attnum INTO STRICT kind_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.shipping_notifications'::regclass
    AND attname  = 'kind'
    AND NOT attisdropped;

  SELECT count(*), min(pg_get_constraintdef(oid))
  INTO check_count, check_def
  FROM pg_constraint
  WHERE conrelid = 'public.shipping_notifications'::regclass
    AND contype  = 'c'
    AND kind_attnum = ANY (conkey);

  IF check_count <> 1 THEN
    RAISE EXCEPTION 'widen_shipping_notification_kinds: expected exactly 1 CHECK constraint on shipping_notifications.kind, found %. A narrow CHECK under a different name likely still exists — inspect pg_constraint (pg_get_constraintdef) and drop the stale one by its real name.', check_count;
  END IF;

  IF check_def NOT LIKE '%lost%' THEN
    RAISE EXCEPTION 'widen_shipping_notification_kinds: the kind CHECK does not include ''lost'' after widening. Live definition: %', check_def;
  END IF;
END
$$;
