# Three-Service Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed security, state-machine, false-success, duplicate-delivery, and dead-code defects identified in the 2026-07-10 audit across `bia-admin`, `bia-roommate`, and `george`.

**Architecture:** `bia-admin` remains the sole owner of executable Supabase migrations and transactional RPCs. `bia-roommate` uses intent-based/idempotent APIs and validates shared contracts before writes. `george` claims durable work atomically and treats follow-ups/delivery as explicit state machines. Each repository ships on its own `codex/audit-fixes` branch with regression tests.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Supabase/Postgres, Express, node-cron.

## Global Constraints

- Start from audited GitHub heads: admin `490d18f`, roommate `43adc6e`, George `888cf6e`.
- Use TDD: each production change must have a regression test observed failing before implementation.
- All schema changes are append-only migrations in `bia-admin/supabase/migrations`; never edit historical migrations.
- Every exposed table has RLS; every privileged function has explicit revoke/grant; views use `security_invoker = true` unless removed.
- Database invariants and multi-row state transitions must be atomic RPCs, not best-effort application sequences.
- Do not change public UX copy except where HTTP/error semantics require it.
- Preserve unrelated user changes and do not push branches.

---

### Task 1: George heartbeat cadence and follow-up consumption

**Files:**
- Modify: `.worktrees/codex-audit-george/src/jobs/heartbeat-scheduler.ts`
- Modify: `.worktrees/codex-audit-george/src/agent/heartbeat.ts`
- Modify: `.worktrees/codex-audit-george/src/jobs/heartbeat-deps.ts`
- Test: `.worktrees/codex-audit-george/tests/jobs/heartbeat-scheduler.test.ts`
- Test: `.worktrees/codex-audit-george/tests/agent/heartbeat.test.ts`

**Interfaces:**
- Produces `parseCadenceMs(cadence: string): number | null` with explicit mappings for `12 hours`, `24 hours`, `7 days`, and `off`.
- Adds `claimDueFollowups(userId): Promise<FollowupRow[]>`, `markFollowupsTriggered(ids): Promise<void>`, and `releaseFollowups(ids): Promise<void>` to heartbeat dependencies.

- [ ] Write a test proving `7 days` is 168 hours rather than the 12-hour fallback and invalid cadence is rejected/fails closed.
- [ ] Run `npm test -- tests/jobs/heartbeat-scheduler.test.ts` and observe the weekly test fail.
- [ ] Replace regex-plus-default parsing with an exhaustive constant mapping; use `null` for `off` and unknown values.
- [ ] Write heartbeat tests proving due rows are claimed once, marked triggered after successful handling, and released after failure.
- [ ] Implement dependency-backed follow-up transitions; never leave a successfully handled due row `pending`.
- [ ] Run the targeted scheduler and heartbeat tests, then `npm test` and `npm run build`.
- [ ] Commit as `fix: make heartbeat cadence and followups deterministic`.

### Task 2: George exactly-one heartbeat action and durable delivery claims

**Files:**
- Modify: `.worktrees/codex-audit-george/src/agent/heartbeat.ts`
- Modify: `.worktrees/codex-audit-george/src/adapters/outgoing-scheduler.ts`
- Modify: `.worktrees/codex-audit-george/src/db/outgoing-bubbles.ts`
- Modify: `.worktrees/codex-audit-george/src/jobs/heartbeat-scheduler.ts`
- Test: `.worktrees/codex-audit-george/tests/agent/heartbeat.test.ts`
- Test: `.worktrees/codex-audit-george/tests/adapters/outgoing-scheduler.test.ts`

**Interfaces:**
- `runHeartbeat` validates `response.toolCalls.length === 1` before invoking any handler.
- Outgoing rows are obtained through a claim/lease operation rather than plain `selectDue`.
- Spectrum disconnect does not report a legacy-queue enqueue as delivered.

- [ ] Write a failing test where two returned tool calls cause zero side effects and an error outcome.
- [ ] Enforce exactly one known tool call before execution and preserve an accurate single outcome.
- [ ] Write failing scheduler tests for two workers claiming the same row and for send-success/mark-failure ambiguity.
- [ ] Change the DB seam to claim rows atomically with worker/lease metadata and bounded retries.
- [ ] Write a failing proactive-sender test for Spectrum reconnect; require retryable failure or a Spectrum-drained queue.
- [ ] Implement the transport-specific failure behavior and adaptive idle/error polling instead of unconditional one-second requests.
- [ ] Run targeted tests, full George tests, and TypeScript build.
- [ ] Commit as `fix: make proactive delivery claim based`.

### Task 3: Canonical database security and state-machine migration

**Files:**
- Create: `.worktrees/codex-audit-admin/supabase/migrations/<generated>_audit_security_and_state_machines.sql`
- Modify/Create tests under `.worktrees/codex-audit-admin/bia-admin/test/` or `lib/**/__tests__/` following existing migration-test conventions.

**Interfaces:**
- Removes `squad_member_counts` after dependency verification.
- Converts `sponsors_public` to `security_invoker = true` with active-row RLS and column-level grants.
- Revokes anon/authenticated/PUBLIC execution from service-only definer functions.
- Enables deny-all/service-only access for memory/internal tables identified by the audit.
- Adds atomic RPCs for follow-up claiming, outgoing-bubble claiming, event deletion, parcel creation plus timeline, article update plus revision, and roommate/pack-request invariants where applicable.

- [ ] Run `supabase --version` and `supabase migration new audit_security_and_state_machines`; use the generated filename.
- [ ] Add catalog/migration tests that fail for exposed definer views/functions and missing RLS.
- [ ] Add SQL for explicit grants/revokes, RLS, invoker view, obsolete-view removal, and transactional RPCs with fixed `search_path`.
- [ ] Add partial unique index `roommate_profiles(user_id) WHERE user_id IS NOT NULL` after a duplicate-detection guard/query.
- [ ] Add indexes supporting claim queries and `FOR UPDATE SKIP LOCKED` leases.
- [ ] Run SQL lint/migration tests and admin unit tests; if a local Supabase stack exists, reset and run integration tests/advisors.
- [ ] Commit as `fix: harden database contracts and atomic workflows`.

### Task 4: bia-roommate profile, likes, deletes, and dead onboarding code

**Files:**
- Modify: `.worktrees/codex-audit-roommate/app/submit/page.tsx`
- Modify: `.worktrees/codex-audit-roommate/components/OnboardingFlow.tsx`
- Modify: `.worktrees/codex-audit-roommate/app/api/likes/route.ts`
- Modify: `.worktrees/codex-audit-roommate/app/api/comments/route.ts`
- Modify: `.worktrees/codex-audit-roommate/app/api/course-rating/reviews/route.ts`
- Delete: `.worktrees/codex-audit-roommate/app/george/profile/_components/IdentityStep.tsx`
- Delete: `.worktrees/codex-audit-roommate/app/george/profile/_components/InterestsStep.tsx`
- Delete: `.worktrees/codex-audit-roommate/app/george/profile/_components/HeartbeatPrefsStep.tsx`
- Add/modify route/component tests following existing Vitest patterns.

**Interfaces:**
- Logged-out submissions either authenticate before persistence or use the new server-side draft/claim RPC; no direct anonymous insert with `user_id: null`.
- Likes use explicit desired state (`PUT liked=true`, `DELETE liked=false`) rather than duplicate-as-toggle.
- Delete endpoints return 404 for zero affected rows.

- [ ] Write failing tests for anonymous submit contract, duplicate profile handling, concurrent like intent, and zero-row deletes.
- [ ] Implement authenticated/draft claim flow and handle `.maybeSingle()` errors.
- [ ] Replace toggle API/caller with idempotent desired-state methods.
- [ ] Return affected rows/counts for deletes and map zero to 404.
- [ ] Remove the three unreferenced onboarding components and confirm no imports remain.
- [ ] Run targeted tests, `npm test`, `npm run lint`, and `npm run build`.
- [ ] Commit as `fix: make roommate profile mutations idempotent`.

### Task 5: bia-roommate shipping, sublet storage, squad, and HTTP semantics

**Files:**
- Modify: `.worktrees/codex-audit-roommate/app/api/shipping/pack-requests/route.ts`
- Modify: `.worktrees/codex-audit-roommate/app/sublet-submit/page.tsx`
- Modify: `.worktrees/codex-audit-roommate/app/api/squad/route.ts`
- Modify: `.worktrees/codex-audit-roommate/lib/schemas/squad.ts`
- Modify: `.worktrees/codex-audit-roommate/app/api/george/chat/route.ts`
- Modify: `.worktrees/codex-audit-roommate/app/george/chat/page.tsx`
- Add/modify tests for these routes/components.

**Interfaces:**
- Pack requests are created/linked by one atomic RPC and every GET query error is surfaced.
- Squad capacity is `int().min(2).max(50)` at draft and API boundaries.
- George relay returns 503 for missing/down backend and 502 for upstream errors while preserving friendly body copy.
- Chat no longer sends ignored `history` payload.

- [ ] Write failing tests for secondary shipping-query errors, orphan rollback, `max_people=1`, and relay error status.
- [ ] Use the canonical pack-request RPC and map duplicate-open-request to 409.
- [ ] Implement storage cleanup/staging for partially uploaded or removed sublet photos.
- [ ] Tighten shared squad validation and map database constraint failures to 400.
- [ ] Correct relay HTTP statuses and remove dead chat history payload/type.
- [ ] Run targeted and full roommate verification.
- [ ] Commit as `fix: close roommate workflow failure paths`.

### Task 6: bia-admin transactional mutations and truthful outcomes

**Files:**
- Modify: `.worktrees/codex-audit-admin/bia-admin/app/api/admin/events/[id]/route.ts`
- Modify: `.worktrees/codex-audit-admin/bia-admin/app/api/admin/shipping/parcels/route.ts`
- Modify: `.worktrees/codex-audit-admin/bia-admin/app/api/admin/articles/[id]/route.ts`
- Modify: `.worktrees/codex-audit-admin/bia-admin/app/api/admin/members/invite/route.ts`
- Modify: `.worktrees/codex-audit-admin/bia-admin/app/api/admin/members/[id]/route.ts`
- Modify: `.worktrees/codex-audit-admin/bia-admin/app/api/admin/members/invitations/[id]/route.ts`
- Modify: `.worktrees/codex-audit-admin/bia-admin/lib/admin/audit-log.ts`
- Add/modify corresponding route tests.

**Interfaces:**
- Routes invoke atomic RPCs created by Task 3 and require affected rows.
- High-risk mutations cannot report success without durable audit/timeline/revision state.

- [ ] Write failing tests for event-delete rollback, missing parcel timeline, missing article revision, ghost invitations, zero-row mutations, and audit failure.
- [ ] Replace multi-call sequences with atomic RPCs and return 404/409 for zero/no-op results.
- [ ] Make high-risk audit failure observable/transactional; retain best-effort only for explicitly low-risk telemetry.
- [ ] Run route tests, all admin tests, lint, and production build.
- [ ] Commit as `fix: make admin mutations atomic and truthful`.

### Task 7: Cross-service contract and dead-code gates

**Files:**
- Modify package/CI configuration in all three `.worktrees/codex-audit-*` repositories.
- Create cross-service contract tests in the owning repositories.

**Interfaces:**
- Shared literals for heartbeat cadence, squad limits, and RPC names cannot drift.
- Dead exports are reported with framework entrypoints configured.

- [ ] Add contract tests covering cadence values, squad capacity, RPC argument names, and expected error/status mappings.
- [ ] Add Knip or equivalent dead-code checks in report-only mode with Next routes/scripts/tool registries configured.
- [ ] Remove confirmed unused test helpers and establish a checked baseline.
- [ ] Run all three full test/lint/build suites.
- [ ] Commit per repository as `chore: add contract and dead-code gates`.

### Task 8: Final review and audit closure

**Files:**
- Modify: `docs/audits/2026-07-10-three-service-full-audit.md`

- [ ] Review each branch diff against this plan and the audit findings.
- [ ] Run fresh full verification in all three repositories and record exact pass/fail counts.
- [ ] Re-run Supabase advisor/catalog checks when a local/live connection is available; clearly separate source-fixed from production-applied.
- [ ] Update every audit finding with `fixed in branch`, `requires production migration`, or `deferred with reason`.
- [ ] Provide branch names and commit SHAs; do not push without user instruction.

