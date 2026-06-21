-- Per-student opt-out flag for shipping notifications.
-- (Phase B · M2 · consumed by the george shipping-notifier + "回复 TD 退订".)
--
-- ⚠️ DRAFT — NOT YET APPLIED. Apply on a Supabase preview branch first.
--
-- WHY: students need a way to stop shipping WeChat/iMessage updates. The
-- consumer (BIBOYANG425/george) will read this column and mark matching
-- queue rows 'skipped' (reason 'opted_out'); an inbound "TD" reply flips it.
--
-- SAFETY: additive, NOT NULL DEFAULT false ⇒ zero behavior change until the
-- consumer honors it. students already has a self-read RLS policy
-- (20260419_shipping_user_link.sql) which covers self-read of this column;
-- service-role (producer/consumer) bypasses RLS. No new policy, no anon
-- exposure. The partial index keeps opt-out filtering cheap.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS shipping_notif_opt_out boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_students_shipping_opt_out
  ON public.students (id)
  WHERE shipping_notif_opt_out = true;
