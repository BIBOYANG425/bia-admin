# Complexity Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the verified over-complication in bia-admin: split migration dirs, dead code, copy-paste scaffolding, and monolith components, with zero behavior change.

**Architecture:** Pure refactor. Delete dead surface first, then extract shared helpers (format, slug, transitions, upload, hooks, StatusPill), then decompose the two monolith components and convert two read-only client pages to server components. Every task keeps the full vitest suite green (baseline: 299 passed / 25 skipped).

**Tech Stack:** Next.js App Router, Supabase, vitest, pnpm workspace, @biboyang425/bia-shared (published package, major-bump policy for breaking changes).

## Global Constraints

- Baseline before any change: `pnpm -r test` → 299 passed | 25 skipped. Every task ends with the suite green.
- **Behavior-preserving.** API response shapes, status codes, and UI visuals must not change unless a task explicitly says otherwise.
- **Migrations are append-only.** Never edit an applied migration. New SQL goes in a new root `supabase/migrations/` file. Do NOT apply anything to the remote DB in this plan.
- **Audit is mandatory** on state-changing admin actions; refactors must preserve every `writeAudit` call.
- **bia-shared breaking change ⇒ major bump** (currently 1.0.0). Additive ⇒ minor.
- **Verify-first:** main moved during review (SR-1..SR-8). Each task's first step re-verifies the finding with grep; if already resolved, skip the task and report.
- If an edited file has a header comment ending `Header last reviewed: YYYY-MM-DD`, update the summary if responsibilities changed and bump the date to 2026-07-06.
- Implementers do NOT commit. Leave changes in the working tree; the orchestrator reviews, runs tests, and commits per task group.

---

### Task 1: Enforce pnpm (npm artifacts already removed from disk)

**Files:**
- Modify: `package.json` (repo root)

- [ ] **Step 1:** Add to root package.json `"scripts"`: `"preinstall": "npx only-allow pnpm"`.
- [ ] **Step 2:** `pnpm install` (must succeed), `pnpm -r test` green.
- [ ] **Step 3:** Commit `chore: enforce pnpm via only-allow (npm artifacts removed)`.

### Task 2: Merge the two supabase directories, fix docs

**Files:**
- Move: `bia-admin/supabase/migrations/*.sql` (9 files) → `supabase/migrations/` (same filenames)
- Move: `bia-admin/supabase/functions/*` → `supabase/functions/`
- Delete: `bia-admin/supabase/` (after moves)
- Modify: `CLAUDE.md` (migration-location claims; also line ~63 says middleware redirects — AdminShell does now), `docs/runbooks/george-parcel-notification.md` (says producer migrations live in `bia-admin/supabase/migrations/` — they live in root)

- [ ] **Step 1:** Verify no filename collisions: every bia-admin migration basename absent from root dir (pre-verified: 9/9 absent; root max timestamp 20260703000006 > bia-admin max 20260615130000, ordering fine — note interleave is safe because all 9 are already applied remotely via MCP).
- [ ] **Step 2:** `grep -rn "bia-admin/supabase" --include="*.ts" --include="*.md" --include="*.json" .` (excluding node_modules) — update every reference (integration tests may read migration SQL by path; vitest config or test helpers may too).
- [ ] **Step 3:** `git mv` the 9 SQL files; `git mv bia-admin/supabase/functions supabase/functions`; remove now-empty `bia-admin/supabase/`.
- [ ] **Step 4:** Fix the doc lines found in Step 2 plus CLAUDE.md/runbook claims. Add one sentence to CLAUDE.md noting edge functions live in root `supabase/functions/`.
- [ ] **Step 5:** `pnpm -r test` green (watch the matching integration tests that read migration files). Commit `refactor: single supabase dir — merge bia-admin migrations + functions into root`.
- [ ] **Step 6 (report-only):** Note in PR body: remote history already contains these versions (applied via MCP); `supabase migration list` may need a one-time `migration repair` — do not run it here.

### Task 3: Delete the stale bia-roommate copy (disk only)

- [ ] **Step 1:** Verify untracked: `git status --short bia-roommate/` shows `??`; verify the real repo `~/Code/bia-roommate` has recent commits (pre-verified: 2026-06-26).
- [ ] **Step 2:** `rm -rf bia-roommate/` (nothing to commit; it is untracked). Frees ~458 MB.

### Task 4: Delete dead GET surface

**Files:**
- Delete: `bia-admin/app/api/admin/users/route.ts`, `bia-admin/app/api/admin/users/__tests__/route.test.ts`
- Modify: `bia-admin/app/api/admin/articles/route.ts` (remove GET; keep POST), `bia-admin/app/api/admin/articles/[id]/route.ts` (remove GET; keep PATCH/DELETE), `bia-admin/app/api/admin/events/route.ts` (remove GET; keep POST), plus their `__tests__` (remove GET-only tests)

- [ ] **Step 1:** Re-verify zero consumers per handler: `grep -rn "api/admin/users\b" bia-admin --include="*.tsx" --include="*.ts"` → only `[id]` fetch (list route dead); article/events consumers are all mutations (pre-verified). `[id]` GET routes for users/events stay for now (Task 15 removes them).
- [ ] **Step 2:** Delete the handlers/files and any now-unused imports (e.g. zod status-filter enum used only by the articles GET).
- [ ] **Step 3:** `pnpm -r test` green. Commit `refactor: delete dead admin GET endpoints (users list, articles list/detail, events list)`.

### Task 5: Delete dead lib/matching/identity.ts

- [ ] **Step 1:** Re-verify: `grep -rln "matching/identity" bia-admin --include="*.ts*"` → only itself + its test.
- [ ] **Step 2:** Delete `bia-admin/lib/matching/identity.ts` + `bia-admin/lib/matching/__tests__/identity.test.ts`. Note in commit body: canonical implementation is SQL `squad_resolve_me()` (see Task 8).
- [ ] **Step 3:** `pnpm -r test` green. Commit `refactor: drop dead TS identity resolver (canonical impl is squad_resolve_me in SQL)`.

### Task 6: Delete dead ui/form.tsx and react-hook-form

- [ ] **Step 1:** Re-verify `components/ui/form.tsx` has zero importers and is the only `react-hook-form` consumer (pre-verified). `ui/sheet.tsx` is USED (MobileNav) — keep it.
- [ ] **Step 2:** Delete the file; remove `react-hook-form` from `bia-admin/package.json`; `pnpm install`.
- [ ] **Step 3:** `pnpm -r test` green. Commit `refactor: drop unused shadcn form.tsx + react-hook-form dep`.

### Task 7: Harden writeAudit; unify callback audit path

**Files:**
- Modify: `bia-admin/lib/admin/audit-log.ts`, `bia-admin/app/auth/callback/route.ts`, `bia-admin/lib/admin/__tests__/audit-log.test.ts`

- [ ] **Step 1:** Failing test: `writeAudit` resolves (does not throw) when `createBiaServiceRoleClient` throws (mock it to throw). Currently the factory call sits outside any try/catch.
- [ ] **Step 2:** Wrap the whole body in try/catch, `console.error("audit log insert failed:", err)` in catch. Test passes.
- [ ] **Step 3:** Replace the inline `admin.from("admin_audit_log").insert(...)` in `app/auth/callback/route.ts` (~line 65) with `writeAudit({...})` preserving the exact fields; keep surrounding behavior identical (it must remain non-fatal).
- [ ] **Step 4:** `pnpm -r test` green. Commit `fix(audit): writeAudit never throws; callback uses the shared helper`.

### Task 8: Squad resolver dedupe migration (file only, not applied)

**Files:**
- Create: `supabase/migrations/20260706000000_squad_board_for_me_delegate_resolver.sql`

- [ ] **Step 1:** Read `20260613000006_squad_board_for_me.sql` and `20260615120000_squad_phase3_rpcs.sql` (post Task 2 they live in root `supabase/migrations/`). Confirm `squad_resolve_me()` still duplicates the JIT block inside `squad_board_for_me`.
- [ ] **Step 2:** Write the migration: `create or replace function squad_board_for_me(...)` with identical signature/security definer/search_path/grants, body reduced to delegate: resolve via `squad_resolve_me()`, then return the existing hybrid search call. Copy revoke/grant statements verbatim from the prior definition. Header comment: why (single canonical JIT resolver) and that behavior is identical.
- [ ] **Step 3:** `pnpm -r test` green (integration tests that exercise this are env-gated/skipped locally). Commit `refactor(sql): squad_board_for_me delegates to squad_resolve_me (single JIT resolver)`. PR body: apply via Supabase MCP after merge; verify with the phase3/phase4 integration tests against dev branch.

### Task 9: Fix users email join (silent 200-user cap)

**Files:**
- Modify: `bia-admin/app/(admin)/admin/users/page.tsx` (~line 73)

- [ ] **Step 1:** Re-verify the `listUsers({ page: 1, perPage: 200 })` block.
- [ ] **Step 2:** Replace with per-row lookups for the page's unique `user_id`s:
```ts
const ids = Array.from(new Set(rows.map((s) => s.user_id).filter((v): v is string => !!v)));
const results = await Promise.all(ids.map((id) => admin.auth.admin.getUserById(id)));
const emailByUserId = new Map(ids.map((id, i) => [id, results[i].data.user?.email ?? null]));
```
Keep the render exactly as-is (fall back to "—" when null).
- [ ] **Step 3:** `pnpm -r test` green; `pnpm --filter bia-admin build` type-checks. Commit `fix(users): resolve emails per displayed row — removes silent 200-user cap`.

### Task 10: lib/format.ts — one fmtDate/fmtDateTime

**Files:**
- Create: `bia-admin/lib/format.ts`
- Modify: every file with a private `Intl.DateTimeFormat` wrapper (survey first; ~12 copies across shipping/users/events/blog/marketplace)

- [ ] **Step 1:** `grep -rn "Intl.DateTimeFormat" bia-admin/app bia-admin/components` — record each copy's locale/options. Group into date-only vs date+time variants.
- [ ] **Step 2:** Create `lib/format.ts` exporting `fmtDate(iso)` and `fmtDateTime(iso)` matching the dominant variant (zh-CN, short month), returning `"—"` for null/undefined. If a page intentionally uses a different format, leave that page alone and note it.
- [ ] **Step 3:** Swap all matching copies to the import; delete the local wrappers. EXCEPTION: skip files owned by Tasks 12/13/15 if running in parallel (blog components, users/[id], events/[id]) — those tasks do their own swap.
- [ ] **Step 4:** `pnpm -r test` green. Commit `refactor: single fmtDate/fmtDateTime in lib/format`.

### Task 11: findAvailableSlug — one slug policy

**Files:**
- Create: `bia-admin/lib/admin/slug.ts` + `bia-admin/lib/admin/__tests__/slug.test.ts`
- Modify: `bia-admin/app/api/admin/articles/route.ts` (create), `.../[id]/route.ts` (PATCH), `.../[id]/submit/route.ts`; DELETE the block in `.../[id]/publish/route.ts`

- [ ] **Step 1:** Read all four copies. Confirm drift: PATCH counts drafts as collisions; create/submit/publish exclude drafts. Confirm publish's copy is a no-op (partial unique index `20260524000003` guards all non-draft statuses and publish only runs from `in_review`/`unpublished`).
- [ ] **Step 2:** Failing tests for `findAvailableSlug(admin, base, { excludeId? })`: returns base when free; skips slugs taken by non-draft rows; ignores draft rows (policy: drafts never count); ignores `excludeId`'s own row; mirrors current candidate generation via `withCollisionSuffix`.
- [ ] **Step 3:** Implement (single `.in()` query, same candidate count as today). Replace the create/PATCH/submit copies with calls; delete the publish block entirely (leave a one-line comment: DB unique index owns the guarantee at this point).
- [ ] **Step 4:** Update route tests that asserted the old PATCH drafts-count-as-collisions behavior — the unified policy is the create/submit one. `pnpm -r test` green. Commit `refactor(articles): one findAvailableSlug helper, drop no-op publish copy (fixes draft-collision drift)`.

### Task 12: Article transition runner

**Files:**
- Create: `bia-admin/lib/admin/article-transitions.ts` + `__tests__/article-transitions.test.ts`
- Modify: `submit/route.ts`, `publish/route.ts`, `reject/route.ts`, `unpublish/route.ts` under `bia-admin/app/api/admin/articles/[id]/` → thin wrappers

- [ ] **Step 1:** Read all four routes; tabulate the differences (min role, allowed from-statuses, target status, extra update fields — e.g. published_at, rejection fields from body, slug finalization in submit — audit action name, response body).
- [ ] **Step 2:** Define `TRANSITIONS: Record<"submit"|"publish"|"reject"|"unpublish", ArticleTransition>` and `runArticleTransition(action, id, auth, body?) → NextResponse`. The runner reproduces the exact skeleton (lookup → 404 → status guard 409 with the same error strings → update → 500 mapping → writeAudit → same response JSON).
- [ ] **Step 3:** Routes become ~10-line wrappers: `withRole(minRole, (auth) => runArticleTransition("publish", id, auth, body))`. URLs unchanged.
- [ ] **Step 4:** All existing transition tests pass UNMODIFIED (they pin the contract). Add one table test asserting each config's from/to/role. `pnpm -r test` green. Commit `refactor(articles): table-driven transitions, 4 routes become wrappers`.

### Task 13: Blog: shared upload helper + BlogEditor decomposition

**Files:**
- Create: `bia-admin/lib/blog/upload-article-image.ts`, `bia-admin/components/blog/HtmlDropZone.tsx`, `bia-admin/components/blog/RejectDialog.tsx`, `bia-admin/components/blog/status.tsx` (StatusPill + labels for blog)
- Modify: `bia-admin/components/blog/BlogEditor.tsx` (785 → ~400), `CoverImageInput.tsx`, `MissingImagesPanel.tsx`, `app/(admin)/admin/blog/page.tsx`, `app/(admin)/admin/blog/[id]/page.tsx`

- [ ] **Step 1:** Read the three components. Extract the duplicated sign → upload → publicUrl flow (both call `/api/admin/articles/cover-upload`) into `uploadArticleImage(file: File): Promise<string>` with the shared constants (bucket, mime whitelist, size cap). Unit-test the validation branches (reject wrong mime/oversize before any fetch).
- [ ] **Step 2:** Extract from BlogEditor: `HtmlDropZone` (drag-drop + CJK detect + title extraction + the pure helpers, exported for testing), `RejectDialog`, and the duplicated status labels/pill into `status.tsx` (also consumed by the two blog pages that re-declare them).
- [ ] **Step 3:** Add unit tests for the now-free pure helpers (`detectLanguage`, `extractTitleFromHtml`).
- [ ] **Step 4:** Visual/behavioral parity: same classNames, same toasts, same fetch calls. `pnpm -r test` green + `pnpm --filter bia-admin build`. Commit `refactor(blog): shared upload helper, HtmlDropZone/RejectDialog/StatusPill extracted from BlogEditor`.

### Task 14: Shipping: shared hooks + StatusPill + list-page dedupe

**Files:**
- Create: `bia-admin/lib/hooks/use-admin-list.ts`, `bia-admin/lib/hooks/use-draft-map.ts`, `bia-admin/components/StatusPill.tsx`; tone maps colocated with labels in `bia-admin/lib/shipping/labels.ts`
- Modify: `app/(admin)/admin/shipping/{requests,contacts,pack-requests,routes,shipments}/page.tsx`

- [ ] **Step 1:** Read the five list pages as they are NOW (post SR-7; sonner toasts already centralized). Confirm which still hand-roll: fetch-on-mount-with-cancelled-flag, duplicate load()/reload() bodies (shipments/page.tsx defined load() then inlined its body in useEffect — verify), `drafts: Record<string, Draft>` editing, `STATUS_CLASS` tailwind maps.
- [ ] **Step 2:** Implement `useAdminList<T>(url)` → `{ data, loading, error, reload }` (sequence-guarded, `cache: "no-store"`), `useDraftMap<Draft>()` → `{ drafts, get, update, clear }` (save/PATCH logic stays per page). Unit-test both hooks.
- [ ] **Step 3:** `StatusPill({ tone, label })` with the tone→class map matching today's exact tailwind strings; move per-status tone maps next to the label maps in `lib/shipping/labels.ts`. Fix the shipments LIST page rendering raw enum values while the detail page shows 中文 labels (use the shared labels — this is the one sanctioned visible change).
- [ ] **Step 4:** Refactor the five pages onto the hooks/pill. De-dup any remaining double fetch bodies. Each page keeps its own filters/payloads.
- [ ] **Step 5:** `pnpm -r test` green + build. Commit `refactor(shipping): useAdminList/useDraftMap/StatusPill — dedupe five list pages`.

### Task 15: Convert users/[id] and events/[id] to server components; delete their GET routes

**Files:**
- Modify: `app/(admin)/admin/users/[id]/page.tsx`, `app/(admin)/admin/events/[id]/page.tsx`
- Create: small client islands (`UserDetailTabs`, `CheckinRoster`) colocated with the pages
- Delete: GET handler in `app/api/admin/users/[id]/route.ts` (delete file if GET-only), GET handler in `app/api/admin/events/[id]/route.ts` (keep PATCH — EventEditor uses it), and their GET tests

- [ ] **Step 1:** Read both pages + routes. Confirm each GET has exactly one consumer (its own page).
- [ ] **Step 2:** users/[id]: async server component running the same queries the route ran (student, email via getUserById, parcels, reviews); tabs become a `"use client"` `<UserDetailTabs>` island receiving both panes (or `?tab=` links). events/[id]: server component fetches event + attendance, renders `<EventEditor>` (client, exists) and new `<CheckinRoster>` client island that POSTs `/checkin` then `router.refresh()`.
- [ ] **Step 3:** Delete the orphaned GET handlers + tests. Use `lib/format.ts` for the dates (finishing Task 10's exceptions).
- [ ] **Step 4:** `pnpm -r test` green + build. Commit `refactor: users/[id] + events/[id] as server components; drop single-consumer GET routes`.

### Task 16: MembersClient dedupe

**Files:**
- Modify: `bia-admin/app/(admin)/admin/members/MembersClient.tsx` (416 lines)

- [ ] **Step 1:** Read current file (SR changes may apply). Confirm the four near-identical fetch→toast→refresh handlers and the three role `DropdownMenuItem`s differing only by role string.
- [ ] **Step 2:** One `mutate(path, init, okMsg)` helper replaces the four; map role menu items over `(["viewer","editor","super_admin"] as Role[])`. No visual change.
- [ ] **Step 3:** `pnpm -r test` green. Commit `refactor(members): single mutate helper, mapped role menu`.

### Task 17: Shipments detail decomposition

**Files:**
- Modify: `app/(admin)/admin/shipping/shipments/[id]/page.tsx` (749 lines)
- Create: colocated `ShipmentEditor.tsx`, plus the panels the file currently inlines (verify names against current content — SR-7 added detach/reassign)

- [ ] **Step 1:** Read the current file. Confirm the N parallel draft `useState`s + hand-written per-field diff persist.
- [ ] **Step 2:** Replace the parallel draft states with one `draft` object + generic diff against the loaded shipment (normalize `"" ↔ null` once). Extract the inline features into colocated components (editor / bulk-advance / attach / detach-reassign as found). Use Task 14's hooks where they fit.
- [ ] **Step 3:** Behavior parity: same PATCH payloads (diff-only fields), same toasts/audit-affecting calls. `pnpm -r test` green + build. Commit `refactor(shipping): decompose shipments/[id]; object draft + generic diff`.
- [ ] **Step 4 (optional, same treatment):** `parcels/[id]/page.tsx` if it still has parallel draft states.

### Task 18: bia-shared dead export prune (verify-first, breaking ⇒ 2.0.0)

**Files:**
- Modify: `packages/bia-shared/src/shipping/types.ts`, `packages/bia-shared/package.json`

- [ ] **Step 1:** For each candidate (`WarehouseAddress`, `ShipmentHistoryEntry`, `PARCEL_CATEGORY_OPTIONS`, `ParcelCategory`, `CN_CARRIER_OPTIONS`, `SHIPPING_CONTACT_TYPES` const, `labelEn` fields): grep this workspace AND `~/Code/bia-roommate` AND `~/Code/george`. SR-1..SR-8 may have started consuming some — prune only confirmed-dead symbols.
- [ ] **Step 2:** If anything is deleted: bump bia-shared to 2.0.0 (breaking per policy) and note the consumer-side follow-up in the PR body. If everything is now consumed, skip and report.
- [ ] **Step 3:** `pnpm -r test` green + build. Commit `refactor(bia-shared)!: prune dead shipping exports (2.0.0)`.

### Final: full gate + PR

- [ ] `pnpm -r test` green; `pnpm -r lint`; `pnpm --filter bia-admin build`.
- [ ] Push branch, open PR with: summary per task, the two operational notes (migration repair one-time; apply Task 8 SQL via MCP), verify CI passes.
