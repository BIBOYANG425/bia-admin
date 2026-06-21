-- Offline (cash / transfer) payment reconciliation bookkeeping on parcels.
-- (Phase B · M5 · backs the admin roster 已收款 marker + CSV amount column.)
--
-- ⚠️ DRAFT — NOT YET APPLIED. Apply on a Supabase preview branch first.
--
-- WHY: payment is OFFLINE (no online checkout). Officers need a minimal way to
-- record "amount owed" and "received money (who/when/how)" per parcel — a
-- bookkeeping aid, not accounting software. Columns live on parcels (1:1, so
-- roster/CSV stay single-query, no join). Amounts are integer CENTS.
--
-- SAFETY / RLS:
-- * Additive nullable columns; no rewrite of existing rows.
-- * parcels self-read RLS is per-user (auth.uid() = user_id), NOT anon-broad,
--   so a student can see only their OWN amount/paid status (acceptable — even
--   useful). We add NO new anon SELECT policy and widen none. Officer writes go
--   through the service-role admin API.
-- * Indexes support the per-shipment roster rollup + unpaid lookups, and the
--   status+shipment scan used by bulk intake / filtered-all.

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS amount_owed_cents integer
    CHECK (amount_owed_cents IS NULL OR amount_owed_cents >= 0),
  ADD COLUMN IF NOT EXISTS paid_at       timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by_admin text,
  ADD COLUMN IF NOT EXISTS paid_method   text
    CHECK (paid_method IS NULL OR paid_method IN ('cash','transfer','other')),
  ADD COLUMN IF NOT EXISTS paid_note     text;

CREATE INDEX IF NOT EXISTS parcels_shipment_paid_idx
  ON public.parcels (shipment_id, paid_at);

CREATE INDEX IF NOT EXISTS parcels_status_shipment_idx
  ON public.parcels (status, shipment_id);
