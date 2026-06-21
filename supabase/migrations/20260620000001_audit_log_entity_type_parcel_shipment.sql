-- Widen admin_audit_log.entity_type so shipping admin mutations can honor
-- writeAudit / logAdminAction with entity_type 'parcel' and 'shipment'.
-- (Phase B · M1 · prerequisite for Phase D/E audit coverage.)
--
-- ⚠️ DRAFT — NOT YET APPLIED. Run the pre-flight below on a Supabase PREVIEW
-- branch first; only apply to prod after the assertions pass + explicit approval.
--
-- WHY
-- ───
-- admin_audit_log.entity_type is `text NOT NULL` gated by a CHECK that
-- enumerates allowed values (the blog work "widened entity_type to include
-- 'article'"). Today it lacks 'parcel'/'shipment', so the shipping parcel route
-- deliberately skips writeAudit (see app/api/admin/shipping/parcels/[id]/route.ts).
-- The table's DDL lives OUT OF BAND (no tracked migration creates it), so we
-- cannot hard-code its constraint name or full value list — we introspect.
--
-- SAFETY
-- ──────
-- * Widening only. We never DROP a value the live CHECK already allows: the
--   fail-safe below RAISEs if the live constraint contains any value not in
--   v_known, so a value we didn't account for aborts the migration instead of
--   being silently dropped. If that fires, add the missing value to v_known.
-- * Idempotent: short-circuits if parcel & shipment are already allowed, or if
--   there is no CHECK on entity_type at all (free text).
--
-- PRE-FLIGHT (read-only — run on the preview branch, reconcile v_known):
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid='public.admin_audit_log'::regclass and contype='c';

DO $$
DECLARE
  v_attnum  smallint;
  v_conname text;
  v_condef  text;
  v_tok     text;
  -- Keep this list reconciled with the live pg_get_constraintdef output above.
  v_known   text[] := ARRAY[
    'admin_user','admin_invitation','article','event_submission',
    'parcel','shipment'
  ];
BEGIN
  SELECT attnum INTO v_attnum
  FROM pg_attribute
  WHERE attrelid='public.admin_audit_log'::regclass
    AND attname='entity_type' AND NOT attisdropped;
  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'admin_audit_log.entity_type not found — confirm table/column names';
  END IF;

  SELECT conname, pg_get_constraintdef(oid)
  INTO v_conname, v_condef
  FROM pg_constraint
  WHERE conrelid='public.admin_audit_log'::regclass
    AND contype='c'
    AND v_attnum = ANY(conkey)
  LIMIT 1;

  IF v_conname IS NULL THEN
    RAISE NOTICE 'No CHECK on admin_audit_log.entity_type; parcel/shipment already allowed.';
    RETURN;
  END IF;

  IF v_condef LIKE '%''parcel''%' AND v_condef LIKE '%''shipment''%' THEN
    RAISE NOTICE 'admin_audit_log.entity_type CHECK already includes parcel & shipment.';
    RETURN;
  END IF;

  -- Fail-safe: refuse to rebuild if the live def has a value we don't know,
  -- because rebuilding from v_known would silently drop it.
  FOR v_tok IN
    SELECT (regexp_matches(v_condef, '''([a-z_]+)''', 'g'))[1]
  LOOP
    IF NOT (v_tok = ANY(v_known)) THEN
      RAISE EXCEPTION
        'admin_audit_log.entity_type CHECK has unrecognized value %; add it to v_known before applying. Live def: %',
        v_tok, v_condef;
    END IF;
  END LOOP;

  EXECUTE format('ALTER TABLE public.admin_audit_log DROP CONSTRAINT %I', v_conname);
  EXECUTE format(
    'ALTER TABLE public.admin_audit_log ADD CONSTRAINT %I CHECK (entity_type = ANY (%L::text[]))',
    v_conname, v_known
  );
  RAISE NOTICE 'Rebuilt % to include parcel & shipment.', v_conname;
END $$;

-- Post-condition: fail loudly if parcel/shipment still rejected.
DO $$
DECLARE
  v_condef text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_condef
  FROM pg_constraint
  WHERE conrelid='public.admin_audit_log'::regclass AND contype='c'
    AND (SELECT attnum FROM pg_attribute
         WHERE attrelid='public.admin_audit_log'::regclass
           AND attname='entity_type') = ANY(conkey)
  LIMIT 1;

  IF v_condef IS NOT NULL
     AND (v_condef NOT LIKE '%''parcel''%' OR v_condef NOT LIKE '%''shipment''%') THEN
    RAISE EXCEPTION 'entity_type widening did not take effect. Live def: %', v_condef;
  END IF;
END $$;
