-- admin_bulk_receive — set-based bulk intake (2026-07-03 shipping refinement, SR-3).
--
-- WHY
-- ───
-- POST /parcels/bulk-receive looped one awaited admin_patch_parcel call per
-- parcel (up to 300 sequential PostgREST round trips ≈ 10–60s behind the
-- 入库中… spinner), and a mid-loop failure/timeout lost ALL accounting — the
-- response and audit row only materialize when the loop finishes. The comment
-- justifying the loop ("concurrent calls would clobber the actor GUCs") was
-- wrong: set_config(..., true) is transaction-local and PostgREST wraps each
-- RPC in its own transaction. The repo's own set-based RPCs
-- (admin_advance_parcels, admin_attach_parcels_to_shipment) are the model.
--
-- WHAT
-- ────
-- One transaction, one UPDATE ... FROM jsonb rows. Eligibility (status =
-- 'expected') is checked IN the UPDATE, so the route's read-then-write
-- snapshot race is gone too. Per-row triggers (parcel_events audit chain,
-- notification enqueue) still fire per updated row under the actor GUCs.
-- Returns the exact id sets so the route/audit/UI can report which parcels
-- were received and which were skipped — no more unrecoverable bare counts.
--
-- SAFETY
-- ──────
-- * New function; nothing existing is redefined. Idempotent CREATE OR REPLACE.
-- * received_at fills only when NULL (explicit officer edits still win via
--   the parcel detail page); weight only overwrites when provided.
-- * Service-role only, like every other admin_* shipping RPC.

CREATE OR REPLACE FUNCTION public.admin_bulk_receive(
  p_items jsonb,          -- [{ "id": "<uuid>", "weight_grams": 1234 | null }, ...]
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_input_ids   uuid[];
  v_updated_ids uuid[];
BEGIN
  PERFORM set_config('app.actor_user_id', p_actor_user_id::text, true);
  PERFORM set_config('app.actor_role', 'admin', true);

  SELECT array_agg(DISTINCT (x->>'id')::uuid) INTO v_input_ids
  FROM jsonb_array_elements(p_items) AS x
  WHERE x->>'id' IS NOT NULL;

  IF v_input_ids IS NULL THEN
    RETURN jsonb_build_object(
      'updated', 0,
      'updated_ids', '[]'::jsonb,
      'skipped_ids', '[]'::jsonb
    );
  END IF;

  WITH items AS (
    -- On duplicate ids, take the last provided weight (arbitrary but stable).
    SELECT DISTINCT ON ((x->>'id')::uuid)
           (x->>'id')::uuid              AS id,
           NULLIF(x->>'weight_grams','')::int AS weight_grams
    FROM jsonb_array_elements(p_items) AS x
    WHERE x->>'id' IS NOT NULL
    ORDER BY (x->>'id')::uuid, x->>'weight_grams' DESC NULLS LAST
  ), updated AS (
    UPDATE public.parcels p
    SET status       = 'received_cn'::public.parcel_status,
        received_at  = COALESCE(p.received_at, now()),
        weight_grams = COALESCE(i.weight_grams, p.weight_grams),
        updated_at   = now()
    FROM items i
    WHERE p.id = i.id
      AND p.status = 'expected'::public.parcel_status
    RETURNING p.id
  )
  SELECT array_agg(id) INTO v_updated_ids FROM updated;

  RETURN jsonb_build_object(
    'updated', COALESCE(array_length(v_updated_ids, 1), 0),
    'updated_ids', COALESCE(to_jsonb(v_updated_ids), '[]'::jsonb),
    'skipped_ids', COALESCE((
      SELECT to_jsonb(array_agg(id))
      FROM unnest(v_input_ids) AS id
      WHERE id <> ALL (COALESCE(v_updated_ids, ARRAY[]::uuid[]))
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_receive(jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
