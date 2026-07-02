-- Notification pipeline correctness (2026-07-03 shipping refinement, SR-6).
-- MUST land before the george consumer goes live. Idempotent; the only data
-- touched is rewriting legacy pending pickup dedup keys (see 3). NOT YET
-- APPLIED TO PROD.
--
-- WHY
-- ───
-- 1. enqueue_parcel_notification INSERTed inside the officer's UPDATE txn with
--    no exception handling — a queue-side constraint error aborts the parcel
--    transition (this exact failure shipped once; see 20260611000001). The
--    app-layer producer (lib/shipping/notify.ts) deliberately swallows errors;
--    the DB producer now does the same.
-- 2. Late arrivals were silent: a parcel reaching arrived_us AFTER the batch
--    flipped pickup_open got no pickup_open/pickup_reminder (the app layer
--    only enqueues on the shipment PATCH). The trigger now enqueues both when
--    the parent shipment is already pickup_open.
-- 3. Pickup dedup keys were lifetime-scoped ('<parcel_id>:<kind>'): a closed-
--    and-reopened window could never notify again, and a reschedule left
--    pending rows with the OLD time/payload. Pickup kinds now carry a window
--    discriminator:
--        <parcel_id>:<kind>:<shipment_id>:<epoch(pickup_starts_at)|na>
--    (epoch seconds — format-stable between SQL and TS, unlike ::text). The
--    app layer (notify.ts) uses the same format and refreshes still-pending
--    rows on re-PATCH. Status kinds (received_cn/…/disputed) intentionally
--    stay lifetime-once: repeating "已到美国" after a wrong-advance correction
--    would be noise; that's an accepted semantic, documented here.
--
-- SAFETY
-- ──────
-- * CREATE OR REPLACE of the trigger fn; same trigger binding (no recreate).
-- * The key rewrite touches only PENDING pickup rows still on the legacy
--    2-segment key, skips any that would collide, and never touches sent rows.
--    Nothing has ever been delivered (george consumer is gated), so the worst
--    case of a skipped rewrite is one duplicate pending row, deduped by the
--    consumer's own idempotency at send time.

-- ─────────────────────────────────────────────────────────────────────────
-- 1 + 2 — trigger: failure-isolated, and covers late arrivals.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_parcel_notification()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  notif_kind    text;
  v_ship_status text;
  v_loc         text;
  v_starts      timestamptz;
  v_ends        timestamptz;
  v_window      text;
  v_payload     jsonb;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.student_id IS NOT NULL THEN
    BEGIN
      notif_kind := CASE NEW.status
        WHEN 'received_cn' THEN 'received_cn'
        WHEN 'in_transit'  THEN 'in_transit'
        WHEN 'arrived_us'  THEN 'arrived_us'
        WHEN 'picked_up'   THEN 'picked_up_thanks'
        WHEN 'lost'        THEN 'lost'
        WHEN 'returned'    THEN 'returned'
        WHEN 'disputed'    THEN 'disputed'
        ELSE NULL
      END;

      IF notif_kind IS NOT NULL THEN
        INSERT INTO public.shipping_notifications
          (student_id, parcel_id, kind, dedup_key, payload, status, scheduled_for)
        VALUES (
          NEW.student_id,
          NEW.id,
          notif_kind,
          NEW.id::text || ':' || notif_kind,
          jsonb_build_object(
            'member_id',   NEW.member_id,
            'from_status', OLD.status,
            'to_status',   NEW.status
          ),
          'pending',
          now()
        )
        ON CONFLICT (dedup_key) DO NOTHING;
      END IF;

      -- Late arrival: the batch's pickup window is already open when this
      -- parcel reaches arrived_us — enqueue the pickup notifications the
      -- shipment-PATCH producer already sent to the on-time parcels.
      IF NEW.status = 'arrived_us'::public.parcel_status
         AND NEW.shipment_id IS NOT NULL THEN
        SELECT s.status::text, s.pickup_location, s.pickup_starts_at, s.pickup_ends_at
        INTO v_ship_status, v_loc, v_starts, v_ends
        FROM public.shipments s
        WHERE s.id = NEW.shipment_id;

        IF v_ship_status = 'pickup_open' AND v_loc IS NOT NULL AND v_ends IS NOT NULL THEN
          v_window := NEW.shipment_id::text || ':'
                      || COALESCE(floor(extract(epoch FROM v_starts))::bigint::text, 'na');
          v_payload := jsonb_build_object(
            'member_id',        NEW.member_id,
            'pickup_location',  v_loc,
            'pickup_starts_at', v_starts,
            'pickup_ends_at',   v_ends
          );

          INSERT INTO public.shipping_notifications
            (student_id, parcel_id, kind, dedup_key, payload, status, scheduled_for)
          VALUES (
            NEW.student_id, NEW.id, 'pickup_open',
            NEW.id::text || ':pickup_open:' || v_window,
            v_payload, 'pending', now()
          )
          ON CONFLICT (dedup_key) DO NOTHING;

          IF v_ends > now() THEN
            INSERT INTO public.shipping_notifications
              (student_id, parcel_id, kind, dedup_key, payload, status, scheduled_for)
            VALUES (
              NEW.student_id, NEW.id, 'pickup_reminder',
              NEW.id::text || ':pickup_reminder:' || v_window,
              v_payload, 'pending',
              GREATEST(now(), v_ends - interval '24 hours')
            )
            ON CONFLICT (dedup_key) DO NOTHING;
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A queue-side failure must never abort the officer's parcel update —
      -- same philosophy as writeAudit / notify.ts.
      RAISE WARNING 'enqueue_parcel_notification failed for parcel %: %',
        NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3 — rewrite legacy pending pickup keys to the window-discriminated format
--     so a reschedule/reopen refresh (which matches on parcel_id + kind +
--     pending) supersedes them instead of orphaning them.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE public.shipping_notifications n
SET dedup_key = n.parcel_id::text || ':' || n.kind || ':' || p.shipment_id::text
                || ':' || COALESCE(floor(extract(epoch FROM s.pickup_starts_at))::bigint::text, 'na')
FROM public.parcels p
JOIN public.shipments s ON s.id = p.shipment_id
WHERE n.parcel_id = p.id
  AND n.status = 'pending'
  AND n.kind IN ('pickup_open', 'pickup_reminder')
  AND n.dedup_key = n.parcel_id::text || ':' || n.kind
  AND NOT EXISTS (
    SELECT 1 FROM public.shipping_notifications x
    WHERE x.dedup_key = n.parcel_id::text || ':' || n.kind || ':' || p.shipment_id::text
                        || ':' || COALESCE(floor(extract(epoch FROM s.pickup_starts_at))::bigint::text, 'na')
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4 — drain index for the (gated) george consumer's poll:
--     WHERE status='pending' AND scheduled_for <= now() ORDER BY scheduled_for.
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS shipping_notifications_drain_idx
  ON public.shipping_notifications (status, scheduled_for);
