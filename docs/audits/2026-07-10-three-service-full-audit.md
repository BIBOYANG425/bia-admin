# BIA three-service full audit — 2026-07-10

Scope: current GitHub `main` for `bia-admin` (`490d18f`), `bia-roommate` (`43adc6e`), and `george` (`888cf6e`); deployed public surfaces at `uscbia.com`, `admin.uscbia.com`, and `trygeorge.app`; alignment against `george/GOAL.md` plus each repo's product docs.

The initial audit was read-only. A subsequent remediation pass implemented source fixes on isolated `codex/audit-fixes` branches; no production forms, chats, database writes, pushes, or deployments were performed.

## Remediation closure — 2026-07-10

| Area | Status | Evidence / remaining condition |
|---|---|---|
| George cadence, exactly-one action, follow-up lifecycle, Spectrum disconnect semantics, idle polling | **Fixed in branch** | `fbf0c60`, `5886782`, `27390ca`; follow-ups now use explicit IDs and are consumed only after an actual matching send. |
| George outgoing bubble concurrency | **Source-fixed; operational limitation remains** | `b242855` plus admin migration `8b11fee` add atomic leases, attempts, idempotency metadata, and a bounded failed state. External iMessage delivery and database acknowledgement cannot be exactly atomic; ambiguous sends still require reconciliation/monitoring. |
| Roommate profile ownership, idempotent likes, truthful deletes, review limiter, submission auth flow | **Fixed in branch** | `838baa6`, `77f7a66`; the one-profile invariant additionally requires the new database migration. |
| Roommate pack requests, shipping read failures, sublet cleanup, squad bounds, relay HTTP semantics | **Fixed in branch** | `6e83b43`; atomic pack creation requires the new database migration to be applied before deploying the client route. |
| Confirmed dead roommate components and unused chat-history payload | **Removed in branch** | `838baa6`, `6e83b43`. |
| Admin event/parcel/article/member/invitation database workflows | **Fixed in branch** | `8b11fee` moves database invariants into atomic RPCs and makes zero-row outcomes truthful. Invitation email delivery remains an observable cross-system partial-failure boundary. |
| Confirmed dead admin test helpers | **Removed in branch** | `cf26a2b`; lint warnings reduced from 23 to 14 without suppressions. |
| Definer-function privileges, internal-table RLS, invoker view, obsolete squad view | **Source-fixed; not production-applied** | Migration `20260710210853_audit_security_and_state_machines.sql` in `8b11fee`; Docker/live Supabase access was unavailable, so reset, advisors, catalog checks, and anon/auth negative integration tests remain mandatory before production. |
| Public George relay identity/admin-token trust boundary and privileged onboarding state machine | **Not fixed in this pass** | P0-3/P0-4 and related onboarding P1 findings require a separate auth/session and onboarding redesign; do not treat this branch as resolving those blockers. |
| Goal/prompt truthfulness, golden AI eval release gate, broad UI/accessibility polish, dependency upgrades | **Deferred** | Product-policy and release-engineering work remains as described in Phases 1–4 below. |
| Repository-wide dead-code CI (Knip/equivalent) | **Deferred** | Confirmed dead paths were removed, but a framework-aware detector should first land in report-only mode to avoid false positives for Next routes and dynamic George tools. |

Verification after remediation:

- `bia-roommate`: 353 tests passed; TypeScript passed; lint 0 errors/2 existing warnings. Build was blocked by sandbox DNS access to Google Fonts.
- `george`: targeted remediation tests 62/62 passed; non-server suite 1,355 passed/11 skipped; TypeScript build passed. The default test entrypoint still requires environment placeholders and server suites cannot bind localhost in this sandbox.
- `bia-admin`: 384 admin tests and 67 shared-package tests passed; 25 database integrations skipped; TypeScript passed; lint 0 errors/14 warnings after dead-helper cleanup. Production build was blocked only by the sandbox denying Turbopack a local port.
- Database migration: static contract tests passed, but no local reset/advisors or live application was performed.

## Executive verdict

Overall release posture: **P0 remediation required before expanding George or onboarding more students**.

The individual apps build and have unusually strong unit-test volume, but the highest-risk failures sit between services:

- Supabase privileged functions and sensitive tables are exposed incorrectly in canonical migrations.
- The public website acts as an unauthenticated admin-token proxy to George and accepts a caller-selected `userId`.
- George's onboarding endpoint creates confirmed auth users behind a reusable six-character code without a rate limit or atomic claim.
- The stated north star says George “tells the truth,” while the system prompt instructs him to deny/deflect that he is AI.
- A real conversation-eval harness exists, but CI deliberately skips it, so the one measurable goal is not enforced on every change.
- The local workspace is not a trustworthy representation of the three current repositories.

## Service scorecard

| Service | Build/tests | Security & correctness | Maintainability | Product/UX alignment | Overall |
|---|---:|---:|---:|---:|---:|
| bia-admin + canonical schema | 85 | 35 | 58 | 76 | **62/100** |
| bia-roommate / uscbia.com | 84 | 30 | 42 | 65 | **55/100** |
| George agent | 86 | 48 | 55 | 57 | **62/100** |
| Cross-service platform | 72 | 25 | 38 | 55 | **47/100** |

### Verification results

| Repo | Result |
|---|---|
| bia-admin | Lint: 0 errors, 23 normal warnings. Tests: 355 passed, 25 DB integration tests skipped. Production build passed. Shared package: 67 tests passed. |
| bia-roommate | Lint: 0 errors, 2 warnings. Tests: 331 passed. Production build passed. |
| George | TypeScript build passed. With documented non-secret test placeholders: 1,354 passed, 11 skipped. Default local `npm test` is not hermetic because production env vars are required at import time. |
| Deploy status | Latest GitHub commits report successful Vercel deploys for admin/roommate and successful Railway deploy for George. |

## Blocking findings

### P0-1 — Anonymous callers can execute privileged database functions

Canonical migrations create `SECURITY DEFINER` functions in `public` without revoking PostgreSQL's default `PUBLIC` execute privilege:

- `approve_event_submission(uuid, uuid)` inserts an active event and marks any pending submission approved. It accepts an arbitrary admin UUID and contains no in-function auth/role check. This bypasses the API's editor gate and weekly cap.
- `append_to_profile_block(uuid, text, text)` writes arbitrary text to any user's long-term George profile. This is a persistent memory/prompt-injection path.
- `publish_scheduled_articles()` is also public-executable. Its impact is narrower because it only publishes due rows, but the privilege is still wrong.

Evidence: [`20260624000008_approve_event_submission_atomic.sql`](https://github.com/BIBOYANG425/bia-admin/blob/490d18f704327270fe78d4313363a2999ea08eb6/supabase/migrations/20260624000008_approve_event_submission_atomic.sql), [`20260621000000_memory_consolidation_additive.sql`](https://github.com/BIBOYANG425/bia-admin/blob/490d18f704327270fe78d4313363a2999ea08eb6/supabase/migrations/20260621000000_memory_consolidation_additive.sql).

Fix:

1. Immediately `REVOKE ALL ... FROM PUBLIC, anon, authenticated` for service-only functions; grant only `service_role`.
2. Put privileged internal functions in a non-exposed schema.
3. Add defense-in-depth identity/role checks inside user-callable definer functions.
4. Add an automated migration test that fails every `SECURITY DEFINER` function without an explicit revoke/grant contract.
5. Verify live privileges from `pg_proc.proacl`; source review cannot prove whether an out-of-band production revoke exists.

### P0-2 — Sensitive public tables have no RLS

`user_observations`, `proactive_raised_threads`, and `identity_conflicts` are created in the exposed `public` schema without `ENABLE ROW LEVEL SECURITY`. No explicit table revokes appear in later migrations. Depending on the project's Data API grants, this can expose private memory, inferred student state, and identity-conflict data to `anon`/`authenticated` access.

Fix: enable RLS, revoke broad table privileges, add service-only policies/grants, and verify via Supabase advisors plus anon/authenticated negative integration tests.

### P0-3 — Public web chat permits caller-selected identity through an admin-token proxy

`POST /api/george/chat` is unauthenticated, un-rate-limited, and forwards a server-held George admin token. The request body controls `userId`; when absent, every caller shares `web-anon`. George's `/chat` endpoint uses that ID for history, memory, usage controls, and pre-orchestrator commands such as `/delete me`.

Impact: identity impersonation, cross-user memory contamination, destructive command targeting, unbounded LLM cost, and shared anonymous conversation history.

Evidence: [`app/api/george/chat/route.ts`](https://github.com/BIBOYANG425/bia-roommate/blob/43adc6ec890440a1fd40dff75dc15bc772daccba/app/api/george/chat/route.ts), [`src/index.ts`](https://github.com/BIBOYANG425/george/blob/888cf6ed8b4231f4b16bddb60ce922f20ba0fbee/src/index.ts).

Fix: derive identity server-side from a signed session or mint a signed, scoped anonymous conversation ID; never accept an authoritative `userId` from the browser. Split the web relay credential from the all-powerful admin credential. Add durable per-identity/IP rate limits and disallow destructive commands for anonymous web sessions.

### P0-4 — Onboarding is a non-atomic privileged account-creation endpoint

`/george/profile/api/submit` is unauthenticated and protected only by a six-character reusable code. It has no rate limit or atomic pending→claimed transition, creates an email-confirmed Supabase auth user, then performs multiple independent writes. Concurrent requests can race; partial failures leave a confirmed auth account and partially updated student/profile state. Existing-user fallback searches only the first 200 auth users.

Related: `/george/api/code` is unauthenticated and un-rate-limited, allowing database spam through the service-role client.

Fix: replace implicit confirmed-user creation with real OAuth/magic-link verification; atomically consume a single-use, expiring, attempt-limited token in a database RPC; make the full onboarding transaction idempotent; remove page-1 auth enumeration; rate-limit both code minting and submission.

## Major findings

### P1-1 — Canonical schema ownership is not reproducible

The canonical baseline migration is an intentional no-op while 39 pre-existing tables only exist in the live database and inert history archives. A clean project cannot be created from Git. This makes disaster recovery, preview databases, integration testing, and schema review unreliable.

Worse, open George PR [#98](https://github.com/BIBOYANG425/george/pull/98) says `proposed_matches`, `funnel_events`, and `events.source_club` are already live, while none exist in `bia-admin/main`, the declared sole migration owner. The PR is currently open and non-mergeable.

Fix: capture a reviewed executable baseline, reconcile live schema against it, move every untracked live change into append-only bia-admin migrations, and prohibit applying a cross-repo migration before its canonical migration PR lands.

### P1-2 — “Mandatory” audit logging is deliberately fail-open

`writeAudit()` swallows every insert/client error, while the repo guardrail says missing audit is a review blocker and every sensitive mutation must be traceable. A state change can succeed with no durable audit record.

Fix: put business mutation + audit row in one database transaction/RPC for high-risk actions. For lower-risk actions, enqueue a durable outbox row in the same transaction. Do not rely on a second best-effort network call.

### P1-3 — George's honesty principle contradicts his identity prompt

`GOAL.md` says trust and honesty are the top quality bar. `prompts/master.md` says George is “just a senior,” must deflect “are you AI,” and must never reveal he is AI. That is intentional identity deception, not persona styling, and it undermines consent—especially because George stores sensitive memory and serves some 17-year-olds.

Fix: keep the playful 学长 voice while answering truthfully: “yeah, I’m BIA’s AI 学长.” Update the deterministic persona tests and public copy together.

### P1-4 — The one measurable AI goal does not gate CI

The golden-conversation harness is substantial, but the real model/judge suite is behind environment flags and CI explicitly leaves them unset. CI validates harness mechanics, not live reply quality, fabrication=0, voice ≥90%, or routing correctness. Therefore prompt/model changes are not actually “held to it on every change.”

Fix: run a small deterministic recorded golden set on every PR, a live-model smoke set on prompt/model/tool-routing changes, and the full judged suite nightly. Store baseline artifacts and fail on fabrication, safety, language, or routing regressions.

### P1-5 — Public LLM cost controls are incomplete and instance-local

- `/api/george/chat` has no rate limit.
- `/api/courses/recommend` can invoke the agent without a rate limit or input-length cap.
- `/api/squad/draft` relays to George with no rate limit or text cap.
- Existing limits use in-memory Maps in Vercel functions and reset on cold start/scale-out.

Fix: use a durable distributed limiter keyed by authenticated user plus trusted proxy IP; cap bodies before JSON/prompt expansion; set upstream timeouts and concurrency budgets; return real 429/5xx semantics rather than masking every backend failure as HTTP 200.

### P1-6 — Vulnerable dependency sets are deployed

- bia-admin: 24 advisories (1 critical, 5 high). The critical Vitest issue is dev-server/UI scoped; several DOMPurify/Undici advisories are in the shared article-sanitization path and need reachability review.
- bia-roommate: 10 advisories (5 high), including direct Next.js `16.2.1`; audit offers a non-major fix to `16.2.10`.
- George: 20 advisories (4 high), including `ws`, `undici`, `form-data`, and an OpenTelemetry chain through direct `spectrum-ts`. The proposed Spectrum fix is a major upgrade and needs a transport regression test.

No repo runs dependency audit in CI.

### P1-7 — Complexity remains concentrated in core flows

Additional ESLint complexity scan (threshold 15; function length 120):

- bia-admin: 53 oversized functions, 23 high-complexity functions. `AdminParcelDetailPage` is 558 lines/complexity 34.
- bia-roommate: 92 oversized functions, 61 high-complexity functions. Core hotspots include `ResultsView` (755 lines), `OnboardingFlow` (715), `DeclareParcelContent` (686), `AgentChat` (569), and course-agent functions with complexity 20–33.
- George: `runOrchestrator` is 338 lines/estimated complexity 65; `runHeartbeat` is 214/31; `runSpectrumLoop` is 194/25.

These are not cosmetic metrics: the hotspots own auth, state transitions, LLM routing, memory, streaming, and payment/shipping flows. Decompose by invariant and state machine, not by arbitrary helper extraction.

### P1-8 — Release gates have intentional holes

Roommate's Chrome extension CI job has `continue-on-error: true`, so a broken extension can merge. Database integration suites are skipped by default (25 admin tests), and George's 11 skipped tests include paid/live evals. Add required, scoped gates and scheduled live integration jobs.

## UX, accessibility, and visual audit

### Technical design scores (0–4 each)

| Surface | A11y | Performance | Responsive | Theming | Anti-patterns | Total |
|---|---:|---:|---:|---:|---:|---:|
| uscbia.com / roommate tools | 2 | 2 | 2 | 2 | 3 | **11/20** |
| admin login + code-level dashboard | 3 | 2 | 3 | 3 | 4 | **15/20** |
| George web surfaces | 2 | 3 | 2 | 2 | 4 | **13/20** |

Positive findings:

- The public visual system is distinctive and recognizably BIA, not generic AI UI.
- Primary builds are responsive enough to remain usable, with strong touch-target sizing on the homepage.
- Admin login is clear, keyboard-addressable, and exposes no dashboard data before auth.
- Deployed pages loaded without console errors during this audit.

Verified issues:

1. **P1 mobile overlay:** the fixed FEEDBACK tab overlaps the roommates year filter, George chat footer/input region, and a `trygeorge.app` suggested question. Give it safe-area-aware placement, avoid fixed overlay on narrow screens, and reserve layout space.
2. **P1 mobile roommates gap:** a large blank vertical gap appears between profile cards after the fifth card at 375px. Fix the grid/masonry row sizing and add screenshot regression coverage.
3. **P1 stale George entrypoint:** the main navbar links to `/george/about`, which still says “COMING SOON,” while `/george/chat` and `trygeorge.app` are live betas. This breaks the goal of George as BIA's single interface.
4. **P2 semantic hierarchy:** the homepage has no H1; its first headings are H2. Add a single descriptive H1 (visually styled as desired).
5. **Not a defect — verified during the follow-up logic pass:** roommates displays a freshman-only social-proof count beside an all-filtered-profiles count. The labels and computations intentionally describe different populations. The original audit treated the numerical difference as suspicious; source inspection confirms it is logically consistent.
6. **P2 first-run friction:** course planner blocks the tool behind an eight-step modal tour. Make the tour optional/progressive and measure completion/drop-off.
7. **P2 theme fragmentation:** the marketing site, brutalist tools, George placeholder, and beta signup feel like adjacent brands. Keep the deliberate editorial/brutalist contrast, but unify navigation, feedback control, typography tokens, and launch-state language.

Screenshot evidence is under `.gstack/qa-reports/screenshots/` in the workspace.

## GitHub and workspace state

- Current GitHub heads: admin `490d18f`, roommate `43adc6e`, George `888cf6e`.
- Local workspace root is admin `d26a852`, far behind GitHub.
- Local `bia-roommate/` is an old embedded subset, not a repository checkout.
- Local `.worktrees/george` points to invalid metadata under `/Users/mac/.git/worktrees/george`.
- Admin and roommate have no open PRs. George has three open, non-mergeable PRs: [#98](https://github.com/BIBOYANG425/george/pull/98), [#52](https://github.com/BIBOYANG425/george/pull/52), and [#22](https://github.com/BIBOYANG425/george/pull/22). Triage as rebase/replace/close; do not leave already-applied schema claims in an abandoned feature PR.

## Production Supabase dashboard investigation — 2026-07-10

Evidence supplied after the initial audit: the last-24-hours dashboard shows 77,850 total requests, 4.5% success, 75,141 API Gateway requests, 74,345 API Gateway warnings, zero API Gateway errors, and two critical `Security Definer View` advisor findings.

### Root-cause assessment

1. **`public.sponsors_public` is intentionally configured as a definer view.** The canonical migration explicitly sets `security_invoker = false`, grants it to `anon` and `authenticated`, and even says the advisor warning is accepted intentionally. The view currently projects only `id`, `name`, `tier`, `logo_url`, `website_url`, and `display_order`, with `where active`, so the current query does not directly expose `contact` or `notes`. This lowers the immediate data-leak impact, but the alert is valid: the view runs with its privileged owner's permissions and future edits can silently cross the trust boundary.
2. **`public.squad_member_counts` is a legacy, owner-executed view that bypasses membership RLS.** It aggregates `squad_members` and grants the result to `anon` and `authenticated`. Its source definition exists only in archived roommate schema history, not in the canonical executable migrations, while the live database still contains it. This confirms the schema-drift problem. Current application code no longer queries it; the public squad API reads `squad_posts_with_status`, and `squad_posts.current_people` is already trigger-maintained. The safest repair is therefore to revoke and drop the obsolete view after a live dependency check.
3. **The request flood is probably George's one-second outgoing-bubble drainer, not either view alert.** When `GEORGE_PACING_ENABLED=true`, George starts a loop with a default 1,000 ms interval. Every tick calls PostgREST to select due rows from `outgoing_bubbles`, even when the queue is empty. A continuously running loop generates up to 86,400 requests/day; the observed 74,345 API Gateway warnings equal about 20.65 hours at one request/second and match the dashboard's flat hourly bars. This is a high-confidence correlation, not yet a confirmed production attribution because repository access cannot inspect Railway environment values or Supabase edge-log paths/status codes.
4. **If the warnings are failing requests, schema/config drift is the leading explanation.** The code itself warns that enabling pacing before applying `20260625000002_outgoing_bubbles.sql` makes the scheduled tail fail on every tick. Other plausible status-specific causes are a stale PostgREST schema cache, invalid/rotated service-role credentials, or gateway throttling. The exact distinction requires grouping live `edge_logs` by path and status code.

### Immediate containment and confirmation

1. In Supabase Logs Explorer, group the last 24 hours by `request.path` and `response.status_code`. If `/rest/v1/outgoing_bubbles` dominates, the source is confirmed. Also inspect `user_agent`, `x_client_info`, and source IP to tie it to the George Railway process.
2. If the feature is not actively required, set `GEORGE_PACING_ENABLED=false` and redeploy George. Request volume should fall within one or two minutes; this is the cleanest diagnostic toggle.
3. If pacing must stay on, verify the live table, indexes, grants, and PostgREST visibility from the catalog and then inspect the dominant status: `404/PGRST205` means missing/stale schema; `401/403` means credential/privilege; `429` means throttling; `5xx/544` means backend/timeout.
4. Replace unconditional one-second polling with an adaptive worker: query once on startup, arm a timer for the next due row, wake on local inserts, and use a bounded 15–60 second recovery poll only when idle. At minimum, exponentially back off empty/error ticks and emit a circuit-breaker alert instead of retrying forever.

### View remediation design

1. For `sponsors_public`, restore an `active`-row RLS policy, grant `anon`/`authenticated` table `SELECT` only on the explicitly public columns needed by the view, and set the view to `security_invoker = true`. Add negative tests proving `contact`, `notes`, and inactive sponsors cannot be read through either the view or direct REST.
2. For `squad_member_counts`, first query `pg_depend` and API logs for consumers, then revoke access and drop it. Use the already-public, transactionally maintained `squad_posts.current_people` value. If aggregate membership counts remain independently necessary, expose them through a narrowly scoped, tested RPC rather than a blanket owner-executed view.
3. Add a migration lint that fails any exposed view without `security_invoker = true`, plus a checked-in exception mechanism requiring owner, rationale, exposed columns, grants, and regression tests.

Investigation status: **probable root cause identified; production-log confirmation still required**. No production configuration or database objects were changed during this audit.

## Non-security logic and dead-code audit

This pass excludes authorization and data-exposure findings already covered above. It looks for behavior that contradicts the product contract, state machines that cannot reach their intended terminal state, and code/data paths with no current consumer.

### Confirmed logic defects

1. **P1 — The “weekly” heartbeat option actually falls back to every 12 hours.** Both roommate heartbeat UIs persist the literal value `7 days`, but George's `parseCadenceHours()` only recognizes `/hours?/`. Any non-matching value silently returns `12`, so a user choosing weekly can become eligible twice per day. Replace free-form cadence strings with a shared enum plus an explicit duration mapping (`12_hours`, `24_hours`, `7_days`, `off`) and add cross-repo contract tests for every UI option.
2. **P1 — Due follow-ups are never consumed.** George loads `student_followups` where `status = 'pending'` and `scheduled_for <= now`, injects them into every heartbeat prompt, but no dependency or code path changes them to the schema's terminal `triggered` state or sets `triggered_at`. A due commitment therefore remains due forever and can be repeatedly surfaced or sent. Claim follow-ups atomically before processing, transition them to `triggered` only after the intended action succeeds, and release/retry with an attempt cap on failure.
3. **P1 — The durable outgoing-bubble sender is not safe across replicas or post-send write failures.** Each worker performs `SELECT pending → external send → UPDATE sent_at` without an atomic claim/lease. Two George instances can send the same bubble, and a successful external send followed by a failed `markSent` causes a resend on the next tick. Add an atomic `claim_due_outgoing_bubbles(worker_id, lease_until)` RPC using `FOR UPDATE SKIP LOCKED`; persist attempts and an idempotency key; reconcile ambiguous sends rather than blindly retrying.
4. **P1 — Spectrum reconnect fallback deliberately writes to an undrained queue.** `makeProactiveSender()` says `imessage_outgoing` has no drainer under Spectrum, yet when the Spectrum client is temporarily null it enqueues there and treats that as successful. The heartbeat then advances `last_heartbeat_at`; the user may never receive the message. Use a transport-specific retry queue that the Spectrum process drains after reconnect, or fail the send so the heartbeat remains retryable.
5. **P1 — Heartbeat says “choose exactly ONE tool” but executes every returned tool call.** `runHeartbeat()` loops over all `response.toolCalls`; a model response can update memory, send a proactive, and add a follow-up in one tick. The final `outcome` is merely whichever tool ran last, so the log can also misrepresent what happened. Enforce exactly one validated call before any side effect, or formally support multiple calls with an explicit transaction/ordered action model and multi-action outcome.
6. **P1 — Onboarding can return success while leaving the invitation pending.** The final `pending_users.status = 'completed'` update ignores its error and immediately returns `{ ok: true }`. A retry then re-enters onboarding and repeats reconciliation/upserts. Make token consumption part of the same transaction as onboarding, check the affected row count, and return success only after the terminal transition commits.
7. **P1 — Onboarding is a sequence of partially durable writes with no rollback.** Auth-user creation, identity reconciliation, student update, matching profile, three profile/config tables, and pending-token completion are separate operations. Any middle failure leaves a real but incomplete user and retries from an ambiguous state. Move the database portion into one idempotent RPC and use an explicit onboarding state machine for the external Auth step.
8. **P2 — Squad capacity validation disagrees across AI draft, API, and database.** The historical/live table contract requires `max_people >= 2`; the manual UI clamps at 2, but the draft prefill accepts any number and the API accepts 1. An AI-generated `max_people: 1` reaches the database and likely becomes an unexplained 500. Put `int().min(2).max(50)` in the shared schema, clamp/validate AI drafts before state assignment, and map constraint violations to 400.
9. **P2 — Web-chat failures are reported as HTTP 200 successes.** Missing configuration, network failure, and upstream non-2xx all return a normal 200 response containing the maintenance message. Client monitoring, availability metrics, caches, and retry logic therefore record backend failure as success. Preserve friendly copy in the response body but return 503/502 and let the UI render it intentionally.
10. **P2 — “Mandatory” audit behavior is logically fail-open.** All 43 admin mutation call sites `await writeAudit()`, but the helper catches every failure and resolves successfully. Callers therefore cannot distinguish “mutation and audit committed” from “mutation committed with no audit.” For state-machine and money/pickup actions, combine mutation and audit in one transaction/RPC; for lower-risk actions, return/queue a durable audit outbox result.

### Confirmed dead or redundant paths

1. `IdentityStep.tsx`, `InterestsStep.tsx`, and `HeartbeatPrefsStep.tsx` under roommate's George profile `_components` directory have no imports or runtime consumers. The live five-card onboarding page reimplements the first two and hard-codes heartbeat defaults instead of using the third. Delete them after checking design-history needs, or restore one shared component flow; do not maintain both.
2. The browser chat builds and uploads the entire local `history` array on every message, but the relay destructures only `message` and `userId` and intentionally discards history. This is dead payload and growing bandwidth/serialization work. Remove it from the client and relay type, or actually use a bounded history contract.
3. `public.squad_member_counts` is a dead database interface in current source: no admin, roommate, or George runtime caller references it. It duplicates the trigger-maintained `squad_posts.current_people` field and remains only as a live legacy object plus archived SQL. Verify live API logs/dependencies, then drop it.
4. Admin lint identifies several unused test helpers/parameters (`thenableQuery`, `thenable`, and underscore-prefixed mock parameters). These are harmless but should be removed so future unused-variable warnings regain signal.
5. George's TypeScript configuration does not enable `noUnusedLocals` or `noUnusedParameters`, and none of the three repositories has a committed dead-code detector. Add Knip (configured for Next route conventions, scripts, dynamic tool registration, and test entrypoints) as a non-blocking report first, then make newly introduced dead exports fail CI after the baseline is cleaned.

### Additional bia-roommate logic defects

1. **P1 — Logged-out roommate submission contradicts the checked-in database contract.** `/submit` allows a visitor to insert a profile with `user_id: null`, then asks them to create an account and link it. The only checked-in insert policy requires `auth.uid() IS NOT NULL`, and the schema-history comments explicitly say real submissions set `user_id`. Unless production has an undocumented out-of-band policy, the advertised pre-auth submission fails at the first insert. Choose one contract: authenticate before insert, or implement a server-minted, expiring draft token and a dedicated anonymous-draft table/RPC.
2. **P1 — One-user/one-roommate-profile is assumed but not enforced.** Both `/submit` and `OnboardingFlow` check for an existing profile in application code, but there is no unique constraint on `roommate_profiles.user_id`. Concurrent tabs or the redirect/check race can create duplicates. Once duplicates exist, `.maybeSingle()` returns an error that the callers ignore, which makes the user appear to have no profile and allows further duplication. Add a partial unique index on non-null `user_id`, use an upsert/claim RPC, and handle lookup errors explicitly.
3. **P2 — Like “toggle” is race-dependent rather than intent-based.** The API tries INSERT and interprets unique violation as “unlike” by deleting the row. Two concurrent likes can produce one successful insert followed by one duplicate-triggered delete, leaving the final state unliked even though both requests expressed like intent. Expose idempotent `PUT liked=true` and `DELETE`, or use one atomic toggle RPC and serialize per `(user_id, profile_id)`.
4. **P2 — Sublet image lifecycle leaks storage objects.** Multiple uploads run before the listing write. If one upload or the later insert/update fails, already-uploaded files are never removed. Removing an existing photo from an edited listing only removes its URL from the row; it does not delete the storage object. Upload into user/listing-scoped staging, commit the listing, then promote/retain referenced objects and garbage-collect abandoned uploads.
5. **P2 — Shipping GET silently converts database failures into empty relationships.** Pack-request listing checks the first query's error but ignores errors from `pack_request_parcels`, `parcels`, and student lookup. Users can receive valid-looking requests with an empty `parcels` array rather than an error. Check every result and return a retriable failure; do not treat “query failed” as “no rows.”
6. **P2 — Pack-request creation still has a non-atomic orphan path.** The database trigger correctly closes the duplicate-open-request race, but the route creates `pack_requests` first and links parcels second. On a link failure it performs an unchecked best-effort delete; a failed cleanup leaves an orphan request. Move request creation plus all links into one RPC and map the trigger's `23505` to 409 instead of 500.
7. **P2 — Several delete endpoints report success when nothing was deleted.** Course-review and profile-comment DELETE handlers do not request affected rows/counts. A missing ID or non-owned row returns `{ deleted: true }`. Return the deleted row with `.select().maybeSingle()` or check an exact count and produce 404 when zero.
8. **P2 — Course-review rate limiting fails open on query errors.** The count query's error is ignored; `count = null` bypasses the ten-per-hour check and the insert proceeds. Move the limit into a transaction/constraint or fail the mutation when the authoritative count cannot be obtained.

### Additional bia-admin logic defects

1. **P1 — Event deletion fallback can erase attendance while preserving the event.** The route first deletes the event; on any `23503`, it deletes `event_attendance` and retries the event delete. The attendance delete result is ignored and the two operations are not transactional. If another non-cascading dependency still blocks the retry, the event remains but its roster may be gone. Replace the fallback with one database RPC that either deletes the complete graph or rolls everything back, and identify the actual blocking relation rather than assuming attendance.
2. **P1 — Parcel creation can succeed without its required initial timeline event.** The parcel row commits first and the `parcel_events` seed insert is explicitly best-effort. This contradicts the shipping invariant that the timeline is the operational history; the UI can show a parcel whose first state has no provenance. Create the parcel and initial event in one RPC/transaction.
3. **P2 — Article revision history is best-effort despite powering restoration/audit semantics.** An article update can commit while its revision snapshot fails, leaving no recoverable record of the saved state. If revisions are a product feature, transactionally save content plus revision; if they are only optional telemetry, stop presenting them as dependable history.
4. **P2 — Failed invitation email rollback can create a permanent ghost invitation.** When Supabase email invitation fails, the route deletes the just-created `admin_invitations` row but ignores deletion failure. A remaining unique row causes future invites to return `already_invited` even though no usable email was sent. Check rollback, allow safe resend of the existing pending row, or model delivery state explicitly.
5. **P2 — Admin member/invitation mutations can audit nonexistent changes.** Role update, admin deletion, and invitation revocation use filtered UPDATE/DELETE calls without selecting/counting affected rows. Supabase can return no error for zero matches; the routes then return `{ ok: true }` and append an audit entry for a change that never happened. Require an affected row and return 404/409 otherwise.
6. **P2 — Operational guarantees are implemented as unrelated best-effort writes.** Parcel timeline, article revision, invitation rollback, and the global admin audit helper all follow “primary mutation succeeds; secondary invariant may silently fail.” This repeated pattern should be eliminated with transactional RPCs/outbox records, not fixed independently in each route.

### Non-security repair order

1. Fix cadence parsing and follow-up consumption first; these can directly spam students and violate user-selected frequency.
2. Make outgoing delivery claim-based and transport-specific before enabling pacing broadly or scaling George beyond one instance.
3. Make onboarding/token completion idempotent and transactional.
4. Align shared schemas for squad capacity, heartbeat cadence, active-hour formats, and relay responses.
5. Correct HTTP failure semantics and audit durability.
6. Delete the confirmed dead components, payload, and legacy view; introduce dead-code CI after cleanup.

## Prioritized remediation plan

### Phase 0 — containment (same day)

1. Inspect live Supabase privileges and RLS with advisors/catalog queries.
2. Ship emergency revokes/RLS for the P0 functions/tables; test with anon and authenticated keys.
3. Disable or firewall public `/api/george/chat` until identity is server-derived and rate-limited.
4. Disable legacy `/george/api/code` and privileged profile submit unless immediately required for the beta.
5. Rotate/scope `GEORGE_ADMIN_TOKEN` after changing the relay contract.

Exit criteria: anon cannot execute privileged RPCs/read memory tables; one web user cannot select another identity; onboarding cannot mint confirmed accounts without verified ownership.

### Phase 1 — repair trust boundaries (1–3 days)

1. Implement signed web sessions and scoped relay credentials.
2. Replace onboarding with expiring single-use token + verified OAuth/magic-link + atomic RPC.
3. Move mutation+audit into transactional RPC/outbox patterns.
4. Patch Next.js and safe transitive dependencies; plan and test Spectrum major upgrade.
5. Make extension/build/security gates required; add dependency audit and secret scan.

### Phase 2 — restore a reproducible platform (3–7 days)

1. Generate/review an executable database baseline and schema-drift check.
2. Reconcile PR #98's live schema into bia-admin or roll it back.
3. Create a cross-repo contract matrix for tables, RPCs, package versions, API endpoints, owners, and rollout order.
4. Repair the local workspace into three valid sibling checkouts or documented worktrees.

### Phase 3 — align George with the north star (1 week)

1. Make AI identity disclosure truthful while preserving voice.
2. Convert the real reply-quality goal into PR/nightly release gates.
3. Decide connector-first vs companion/concierge and encode one product contract across GOAL, README, public copy, prompts, and analytics.
4. Define the PII-to-LLM policy before enabling memory capture broadly.

### Phase 4 — reduce failure surface and polish UX (1–2 weeks)

1. Split orchestrator, course-agent, onboarding, shipping, and admin-page monoliths around explicit state machines and boundaries.
2. Add contract/integration tests for web→George→Supabase and admin→RPC→audit.
3. Fix mobile overlays/gaps, stale George navigation, and H1 hierarchy.
4. Re-run full browser QA, dependency audit, Supabase advisors, and adversarial code review.

## Definition of done

- Zero anonymous execute on service-only functions; RLS/advisors clean for exposed schemas.
- Clean environment can be built from migrations alone.
- Web identity is non-forgeable; destructive agent commands require authenticated ownership.
- Onboarding is verified, atomic, single-use, expiring, rate-limited, and idempotent.
- Every privileged mutation has a durable audit record in the same transaction/outbox.
- Required CI: lint, typecheck, build, unit, contract, dependency, extension, and selected golden AI evals.
- George truthfully identifies as BIA's AI agent.
- No P0/P1 responsive or accessibility defects on core mobile flows.
