# 集运 Shipping Refinement Plan

> Owner: splongxl · Date: 2026-07-03
> Source: 61-agent review workflow (4 layer mappers → 7 dimension reviewers → adversarial verification of every P0–P2 finding → completeness critic). 70 findings raised, **68 confirmed, 2 refuted**, plus **6 critic gaps** the dimension reviewers missed. Every confirmed finding was independently re-verified against current code (post PRs #45–#49).
> Severity mix: **0 × P0, 11 × P1, 36 × P2, 21 × P3** + critic gaps (1 × P1, 4 × P2, 1 × P3).

---

## Verdict in one paragraph

The shipping core is in genuinely good shape: the recent hardening pass (atomic attach/advance RPCs, one-open-pack-request trigger, row-locked pickup confirm, uniform `withRole` gating, 100% `writeAudit` coverage on mutations, integer-cents money with DB CHECKs) closed the worst race classes and the architecture patterns are right. What remains is **second-order**: three DB races the hardening pass didn't reach, a pickup desk that ignores payment and has an unguarded student-side bypass, one true N+1 on the hottest bulk path, a test suite that mocks away the two guardrails it exists to protect (audit + role), and a notification queue with lifetime-scoped dedup that will misfire the day George goes live. Nothing here is a prod fire today; several become fires at the first real shipping season.

---

## What's working well (do NOT churn these)

- **Atomic RPC pattern** — `admin_attach_pack_request` (FOR UPDATE + in-txn re-validation + recognizable RAISE tokens → clean 404/409) and `admin_advance_parcels` (single set-based UPDATE, explicit status-index map, terminal protection) are the model; new work should copy them.
- **Pickup defense-in-depth** — row-locked, idempotent, token-re-checking `admin_confirm_pickup_by_token`, REVOKEd to service-role; verify route rate-limited (30/min per officer) with honest inline docs; multi-match 409 has a designed escape hatch (parcel-detail 确认取件).
- **Uniform security posture** — all 21 route handlers wrapped in `withRole` (GET=viewer, mutation=editor, zero gaps); server pages self-gate before creating the service-role client; every admin RPC is SECURITY DEFINER + `SET search_path` + REVOKE from anon/authenticated; `admin_patch_parcel` is a strict column whitelist; PostgREST `.or()` injection sanitized on both call paths.
- **Audit backbone** — every state-changing endpoint audits AFTER the successful write with a consistent `entity.verb` taxonomy; actor GUCs flow through RPCs so `parcel_events` distinguishes admin/user/system; failure-isolation (log-and-swallow) applied deliberately and uniformly.
- **Data model fundamentals** — money is integer cents with CHECKs end-to-end; all timestamps timestamptz; `received_at` stamping centralized in the DB; notification enqueue idempotent by construction; migrations carry WHY/FIX/SAFETY blocks and idempotent DDL.
- **UX bones** — intake pipeline shape (paste → match → review → confirm) is right; parcels list (the one that grows) is server-rendered + paginated + sanitized-searchable; pickup page is phone-first (autoFocus, Enter-to-submit, iOS-safe scanner, lazy-loaded zxing); status presentation is consistent via shared pills/steppers; destructive ops have proportional confirms; diff-only saves prevent no-op writes.
- **Test discipline where it exists** — 14 suites, one consistent mock pattern, 214 green tests; RPC payloads pinned exactly; negative paths on tested routes are strong; lib pure functions have sharp edges covered.

**Refuted (don't fix):** `updated_at` maintenance and status CHECK vocabularies are handled by triggers/CHECKs in the prod DDL (visible in bia-roommate's migrations) — invisible from this repo only because of the known WS0.1 drift.

---

## Workstreams

Ordered by risk-to-correctness, then leverage. Each is independently shippable as one PR (except SR-2's decisions).

### SR-1 — DB state-machine hardening 🔴 (5 × P1/P2 correctness; effort M)

One new migration (`admin_shipping_state_hardening`) + small route edits. Copies the `admin_attach_pack_request` pattern to the three paths it didn't reach:

1. **`admin_patch_parcel`: in-RPC transition re-check.** Currently read-then-write: the route runs `checkTransition` then the RPC applies status unconditionally (no FOR UPDATE, no from-status check) — a concurrent pickup-desk confirm can be *resurrected* by an in-flight PATCH (`picked_up → in_transit`). Fix: `SELECT … FOR UPDATE` + re-run the terminal/backward guard in plpgsql (minimum: RAISE if old status is `picked_up` and the patch changes status). Route keeps `checkTransition` as the friendly fast path. `parcels/[id]/route.ts:126-157`, migration supersedes `20260624000001_admin_patch_parcel…`.
2. **Kill the `shipment_id` mass-assignment bypass.** `PATCH /parcels/[id]` accepts `shipment_id` with zero validation — bypasses every attach guard (can attach an `expected` parcel to an archived shipment, re-point a `picked_up` parcel, silently detach). Fix: **drop `shipment_id` from `PatchParcelBody`** and route all attachment through `/attach`; add a guarded **detach** endpoint in SR-7 (parcel must be `received_cn`, shipment must be forming/sealed). `parcels/[id]/route.ts:37`.
3. **`admin_attach_parcels_to_shipment`: in-txn shipment re-check.** The forming/sealed check lives only in the route precheck — the exact TOCTOU that PR #49 fixed for pack-requests is still open on the direct attach path. Fix: same `RAISE 'shipment_not_attachable'` re-check inside the RPC; map to 409 in `shipments/[id]/attach/route.ts` like the pack-request route already does.
4. **Partial pack-request attach must not flip to `approved`.** Today `v_attached < v_total` (even `v_attached = 0`!) still marks the request approved + linked, stranding un-received parcels with no re-attach path (approved is past the ATTACHABLE set). Fix: only approve when `v_attached = v_total`; otherwise leave status untouched and return `{total, attached}` so the officer re-runs after intake. Alternative (if partial-approve is desired): permit re-attach from `approved` when the target shipment equals the stored `shipment_id`.
5. **Block `shipment → archived` while attached parcels are non-terminal** (critic). Archived is terminal with an empty branch set, so a batch archived with `arrived_us` parcels strands them forever ("到了，等 BIA 安排取件" + dedup already spent). Route-level check (or in an RPC): reject archive unless every attached parcel is `picked_up`/`lost`/`returned`.

**Verify:** new RUN_DB_TESTS cases in SR-5 pin all five; `pnpm -r test` + type/lint/build green.

### SR-2 — Pickup desk integrity 🔴 (critic P1 + 4 P2; effort M; **3 product decisions needed**)

The desk flow works, but it ignores money, has an unguarded side door, and no undo. Decisions first (recommendations inline):

- **D1 — `student_confirm_pickup` bypasses every desk control** (critic, P1). The student-side RPC (GRANTed to `authenticated`, live behind a one-tap 确认取件 button on uscbia.com) flips `arrived_us → picked_up` with only an ownership check — no token, no payment, no desk presence, terminal. It directly contradicts the pickup-token migration's own safety rationale. **Recommend:** gate the RPC on the parent shipment being `pickup_open` AND (`amount_owed_cents` settled or zero) — this repo owns the migration; bia-roommate needs no code change to keep working for the legit case. Also make the desk's 404 distinguish "already picked_up (self-confirmed at \<time\>)" so officers aren't debugging with the parcel in hand.
- **D2 — payment is invisible at the hand-off moment** (critic, P2). Verify/confirm responses select no payment fields; the pickup page never shows 未付款; cash is collected at this exact desk. **Recommend:** return `amount_owed_cents`/`paid_at` from verify + confirm-pickup; render an unmissable unpaid banner with a confirm-anyway interstitial (warn, don't hard-block); optional per-shipment "require-paid" toggle later.
- **D3 — no sanctioned undo for a wrong confirm** (critic, P2). `picked_up` is terminal even into `disputed`; the only correction path is SQL in prod, invisible to audit. **Recommend:** super_admin-only revert RPC (`picked_up → arrived_us`, requires a reason, writes `parcel_events` + audit), surfaced ONLY on the parcel detail page — plus allow `picked_up → disputed` as the contest path.

Mechanical fixes (no decisions):

- **`pickup_token` unique + indexed.** Token is a non-unique 8-char md5 substring with no index; verify resolves the parcel BY token, so a collision can confirm the wrong student's parcel (the multi-match 409 mitigates only when both are simultaneously `arrived_us`). Migration: backfill-dedupe, then `CREATE UNIQUE INDEX`, and collision-retry at generation. Also index `tracking_cn` (intake lookup).
- **Audit failed verify attempts** — the rate-limit comment claims "every attempt is already written to the audit log"; only successes are. Audit 404/409 outcomes (action `parcel.pickup_verify_failed`), and stop storing the raw code in the success payload (store last 2 chars or a hash).
- **Per-student desk view + scanner re-arm** — after a successful scan, show the student's remaining `arrived_us` parcels (member_id is already in the response) and auto re-arm the scanner; a 3-parcel student should be 3 scans with zero extra taps, not scan→tap→scan→tap.

### SR-3 — Bulk-receive: make it atomic 🔴 (2 × P1 + 2 × P2; effort M)

One RPC kills four findings:

- **New `admin_bulk_receive(p_items jsonb, p_actor_user_id uuid)`** modeled on `admin_advance_parcels`: one transaction, one `UPDATE … FROM jsonb_to_recordset` (id, weight_grams), `WHERE status='expected'` **in-txn** (closes the stale-snapshot race), stamps `received_at`, returns `{updated_ids, skipped_ids}`. Replaces up to **300 sequential RPC round trips** (10–60s spinner; a timeout mid-loop currently loses all accounting). The "GUC clobber" comment justifying the loop is factually wrong — `set_config(…, true)` is transaction-local.
- **Route + audit record id lists** — today `failed` is a bare count, the rpcErr is never logged, and the audit row has `entity_id: null`; after a mid-batch failure nobody can tell which parcels were left un-received. Include `updated_ids`/`skipped_ids`/`failed_ids` in both the response and the audit payload.
- **Intake page keeps failed rows** — currently failed parcels vanish from the review list with no retry path; keep them visible, flagged, re-submittable.

### SR-4 — Test backbone: give the suite teeth 🟠 (4 × P1 + 5 × P2; effort M–L)

The suite is well-built but structurally blind to the three things CLAUDE.md declares sacred:

1. **RUN_DB_TESTS shipping RPC integration suite** (highest-value single item in this plan). The most-patched correctness surface — rewritten 5× in one week — has zero executable SQL tests; every route test mocks `rpc()`. The harness already exists (`lib/matching/__tests__/rpc.integration.test.ts` pattern). Cases: advance-parcels skip matrix (never touches `picked_up`), attach-pack-request happy/reject/empty/partial, one-open-request 23505, confirm-pickup idempotency + wrong token, patch-parcel received_at stamping — **plus every new SR-1/SR-3 RPC behavior**.
2. **Assert `writeAudit`** — mocked in all 13 suites, asserted in none; you could delete every audit call and 214 tests stay green. ~2 assertions per file on existing tests (called once with expected action/entity on success; NOT called on 400/404/409).
3. **Assert the min-role arg** — every mock discards it; `editor → viewer` on a mutation route passes the suite. Shared mock helper records `lastMinRole`; one assertion per route.
4. **pickup/verify suite** — the desk-critical route has zero tests: 429 + Retry-After, 0/1/many match fan-out, the three RAISE-substring→status mappings (a reworded RAISE silently becomes a raw 500 today), `status='arrived_us'` scoping.
5. Backfill: bulk-receive, payment (mark/undo semantics), confirm-pickup, transitions edge cases (unknown-status pass-through, terminal→branch), notify.ts (reminder clamp math), sanitizeSearchTerm actually-called-by-route, CSV escaping.

### SR-5 — Audit depth & money trail 🟠 (5 × P2 + 4 × P3; effort S–M)

- **Old→new values in audit payloads** where they're missing: payment (the money trail — currently an undo erases who/when/how with no prior record; read-before-write then include priors), routes pricing, contacts. Clear or document `paid_note` surviving undo.
- **`parcel.create` writes a `parcel_events` row** — officer-created parcels currently have an empty timeline.
- **Bulk audit rows carry id lists + real `entity_id`** (attach/advance too, not just bulk-receive).
- **Audit the CSV export** (it exports member payment data).
- **Notification enqueue observability**: include enqueued-count in the shipment PATCH audit payload; surface failures beyond console.error (SR-6 covers the queue itself).
- Optional: route payment mutations through a small SECURITY DEFINER RPC that also writes a ledger/`parcel_events` row.

### SR-6 — Notification pipeline correctness 🟠 (4 × P2/P3; effort M; **must land before George go-live**)

Nothing is delivered yet (George consumer gated), so these are silent — they become live student-facing incidents on day one:

- **Dedup keys are lifetime-scoped** (`<parcel_id>:<kind>`): a reopened pickup window enqueues nothing; a corrected-then-real arrival never re-notifies; rescheduling a window leaves pending rows with the OLD time and OLD location in the frozen payload. Fix: window discriminator in shipment-level keys (e.g. `${parcel_id}:pickup_open:${shipment_id}:${pickup_starts_at}`); update-not-ignore still-`pending` rows on reschedule; document lifetime-once as an accepted semantic for status kinds.
- **Late arrivals**: a parcel reaching `arrived_us` after pickup_open gets no pickup notification — enqueue from the parcel trigger when the parent shipment is already `pickup_open`.
- **Failure-isolate the DB trigger**: `enqueue_parcel_notification` INSERTs inside the officer's transaction with no exception handler — this exact failure already caused hard 500s once (documented in 20260611000001). Wrap in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING`.
- **Drain index + retention**: index `(status, scheduled_for)` for the consumer; decide retention (or at least document unbounded growth).

### SR-7 — Officer UX sweep 🟡 (12 × P2/P3; effort M)

- **Mis-attach recovery**: detach affordance (guarded per SR-1's rules) + a confirm on attach.
- **Parcel identity correction** (critic P2): a parcel matched to the wrong student can never be re-pointed — no mutation path touches `member_id`/`student_id`/`user_id`. Guarded reassign action (editor+, confirmation, RPC re-derives `user_id` from students, `parcel_events` + audit, blocked once `picked_up`). Same RPC solves the **walk-in parcel** hole (created with NULL student_id/user_id → permanently invisible to the student and excluded from all notifications).
- **Role-aware UI**: 5 pages render full write controls to viewers who discover read-only via a 403 toast after filling a form; hide/disable via the existing `useRole()`.
- **Attach panel**: search within unassigned parcels; remove the silent 200-row cap (exactly the peak-season number) — paginate or show "N more not shown".
- **Consistency sweep**: Chinese labels for shipment statuses in list/pickers (label map exists, trapped in detail page); map raw `invalid_transition`-style codes to Chinese messages; add `catch` to requests/routes/contacts save paths (network failure currently = zero feedback); zh-CN date formatting; intake ambiguous/unmatched cards link to manual-resolution; pending pack-request/发货请求 counts on the overview + make the overview reachable from nav; roster payment row mobile layout + visible validation errors + editable paid method/note.

### SR-8 — Security & validation tightening 🟡 (6 × P2/P3; effort S)

- **`import "server-only"` in `bia-shared/src/supabase/service-role.ts`** — the CLAUDE.md guardrail ("enforced by living in a server-only export path") does not actually exist: the factory is re-exported from the root barrel that 10+ client components import. Key doesn't leak today (env read at call time), but the enforcement is imaginary. Add the sentinel now (build-time failure on client import); remove the root-barrel re-export at the next bia-shared **major** (cross-repo coordination).
- **Zod for routes/contacts PATCH** (the only unvalidated mutation routes: `Number()` → NaN, no length caps on public-site-visible fields, `qr_code_url` accepts any string).
- **Validate parcels list `limit`/`offset`** (NaN currently reaches PostgREST → 500 instead of 400); add LIMIT to shipments/requests list endpoints.
- **qr-upload**: derive the storage extension from the validated MIME type, not the client filename.
- **CSV formula guard**: trim leading whitespace/tab/CR before the `=+-@` check.

### SR-9 — Cross-repo & scale follow-ups 🟡 (async)

- **bia-roommate: render the pickup QR** (critic P2). The admin scanner shipped, but the student page renders the token as *text* ("报给运营核销") and has no QR library — the scanner currently has nothing to scan. ~10-line change with `qrcode`, raw-token payload per the CLAUDE.md contract. Manual entry is already the pickup page default, so not blocking — but it's the whole point of the scanner.
- **bia-roommate: student_confirm_pickup gating** — lands here (we own the migration), but coordinate messaging/UX on the student side per D1.
- **bia-shared major**: root-barrel service-role removal (SR-8) + consumers bump.
- **Perf polish**: pack-requests list pagination (unbounded fetch-all of full history, wholesale refetch per save — move to server-filtered + status-default open); shipment detail/roster column-restricted selects. Fine at today's volume; do before next season.
- **WS0.1 tie-in**: the duplicate `20260624000001` migration version (P1 here, breaks `supabase migration up`) is already Step 3 of the WS0.1 schema-reconcile plan — now unblocked (CLI installed). Land WS0.1 Step 0–3 **before or together with SR-1's migration** so new migrations apply cleanly; add the one-line CI check for duplicate version prefixes.

---

## Suggested execution order

| Order | WS | Why first | PR shape |
|---|---|---|---|
| 1 | SR-1 + duplicate-version rename (WS0.1 Step 3) | Correctness races; everything else layers on clean migrations | 1 migration + route edits |
| 2 | SR-3 | Hottest officer path this season; one RPC kills 4 findings | 1 migration + route + intake page |
| 3 | SR-4 (items 1–4) | Pins SR-1/SR-3 behavior before further churn | test-only PR |
| 4 | SR-2 (after D1–D3 locked) | Desk integrity + money at hand-off | 1 migration + verify/pickup pages |
| 5 | SR-5 | Audit depth | small PR |
| 6 | SR-6 | Before George go-live | 1 migration + notify.ts |
| 7 | SR-8 | Small, mechanical | small PR |
| 8 | SR-7 | Biggest visible payoff, safest to do last | 1–2 PRs |
| 9 | SR-9 | Cross-repo / async | per-repo |

Verification gates per PR: `pnpm -r test` (incl. new RUN_DB_TESTS suite against the dev branch where SQL changed), lint/type/build, and the existing CI required checks. All migrations append-only + idempotent per guardrails; any prod-apply follows the WS0.1 safety rules (no untested DDL on prod).

---

## Decisions needed before SR-2

1. **D1** Student self-confirm: gate on `pickup_open` + paid (recommended) / demote to request-only / keep + better desk error?
2. **D2** Unpaid at desk: warn + confirm-anyway (recommended) / hard block / per-shipment toggle?
3. **D3** Wrong-confirm undo: super_admin revert RPC + allow `picked_up → disputed` (recommended) / disputed-only / SQL-only status quo?

---

## Appendix — full finding index

Raw structured output (all 68 confirmed findings with verified details, 2 refutations, 6 critic gaps, per-dimension working-well inventories):
`/private/tmp/claude-501/-Users-longxl-Desktop-Claude-BIA-bia-admin/5b850196-da90-4205-a2d3-3fb46f9d3591/tasks/wq3f5t1ju.output` (session-scoped; copy out if needed long-term).

P1 index: shipment_id mass-assign bypass · patch-parcel TOCTOU resurrection · attach RPC missing in-txn shipment check · partial attach still approves · bulk-receive failure detail discarded · bulk-receive N+1 (300 sequential RPCs) · duplicate migration version 20260624000001 · RPC SQL has no executable test · pickup/verify zero tests · writeAudit never asserted · withRole min-role never asserted · [critic] student_confirm_pickup bypasses desk controls.
