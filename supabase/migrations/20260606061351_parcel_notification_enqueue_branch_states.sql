-- Parcel-status notification producer · branch-state extension
-- (Retention roadmap · Phase 1a · B1.1)
--
-- Extends enqueue_parcel_notification() to also fire for branch end-states:
--     lost      → 'lost'
--     returned  → 'returned'
--     disputed  → 'disputed'
--
-- These are bad-news transitions, so george should hold them behind a delay
-- (15 min recommended) to let an officer reach out personally first. That
-- delay is implemented in the consumer, not here -- here we just enqueue
-- with the same scheduled_for=now() pattern; the consumer decides when to
-- send.
--
-- Idempotency unchanged: dedup_key = '<parcel_id>:<kind>'.

CREATE OR REPLACE FUNCTION public.enqueue_parcel_notification()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  notif_kind text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.student_id IS NOT NULL THEN
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
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger already exists from the base migration; no need to recreate.
