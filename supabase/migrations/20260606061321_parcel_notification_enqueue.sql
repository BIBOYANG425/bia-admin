-- Parcel-status notification producer  (Retention roadmap · Phase 1a · B1)
-- Source: bia-roommate/supabase/migrations/20260606_parcel_notification_enqueue.sql
--
-- Wires public.shipping_notifications to public.parcels via an AFTER-UPDATE
-- trigger. Additive; coexists with the existing log_parcel_status_change audit
-- trigger.
--
-- Status → notification kind:
--     received_cn  → 'received_cn'
--     in_transit   → 'in_transit'
--     arrived_us   → 'arrived_us'
--     picked_up    → 'picked_up_thanks'
--     (lost / returned / disputed are handled by a follow-up migration to
--      preserve the source file's wire-protocol; expected stays internal)
--
-- Idempotency: dedup_key = '<parcel_id>:<kind>' + ON CONFLICT DO NOTHING.

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

DROP TRIGGER IF EXISTS trg_parcels_enqueue_notification ON public.parcels;
CREATE TRIGGER trg_parcels_enqueue_notification
  AFTER UPDATE ON public.parcels
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_parcel_notification();
