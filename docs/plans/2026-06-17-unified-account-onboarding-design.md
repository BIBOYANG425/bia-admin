# Unified Account + Onboarding across Web and George

Date: 2026-06-17
Status: In progress on `feat/unified-account-onboarding` — Phase 1 verified (no migration
needed, §7); Phase 2 bia-shared contract landed (`packages/bia-shared/src/students`, v0.4.0).
George refactor + web work pending.
Scope: cross-repo — bia-admin (schema + bia-shared), george (agent), bia-roommate (web)

## The problem (current state)

A single student exists today across records in one Supabase project
(`ujkaregrwrppaehvbahf`). The web↔student join key **already exists but nothing on the web
uses it**; there is no student web login and no shared onboarding contract:

| Silo | Repo / surface | Keyed by | Login | Onboarding |
|---|---|---|---|---|
| `admin_users` | bia-admin / admin.uscbia.com | `auth.users.id` + email (Google OAuth) | officers only | none (invite → role) |
| `students` | george (iMessage/WeChat) + web | `wechat_open_id` / `imessage_id` / **`user_id`→auth.users** | chat (web login not built) | the only real onboarding |
| `roommate_profiles` | bia-roommate / uscbia.com `/submit` | nothing (anonymous) | none | single form |

`admin_users` is shown for context only — it is **not** a unification target (see
Non-goals). This design unifies the **student** identity: web login ↔ George.

Consequences:
- **No student web login exists** (any branch). `bia-roommate/lib/supabase.ts` uses the
  anon key with zero auth calls; `app/` has only `/`, `/submit`, `/privacy`.
- **The join key already exists — and is unused.** Verified in the live DB:
  `students.user_id` → `auth.users` (FK + unique index), populated for 5 of 58 rows, with
  RLS enabled and a `read_own_student_row` SELECT policy already in place. What's missing is
  a **web login** to populate it at scale and a **write path** to edit the row — not the key.
  (`001_george_schema.sql` lacks this column; it was added to the baseline by the uscbia.com
  schema, which is why the first investigation pass missed it.)
- **No shared contract.** The onboarding field set lives only inside George's prompts
  (`george/src/agent/personality.ts:594-636`). `bia-shared` exports only
  `AdminUser`, `AdminInvitation`, `Article` — no `Student` / onboarding type. Any web
  onboarding would drift from George's on day one.

There is nothing to make "the same across web and George" until a shared account
identity exists. This doc designs that identity and the onboarding contract on top of it.

## Goal & non-goals

**Goal:** one canonical account record per student, reachable identically from web login
or George; one onboarding contract both surfaces satisfy; one account page showing the
same data George collects.

**Non-goals:**
- Identical *rendering of the account page*. Onboarding is the same George chat on every
  surface (§5); the account **page**, though, is web-native — you view and edit fields on a
  page, while George edits the same `students` fields conversationally. Same data, same
  completion rule; only the account-page surface differs.
- **Unifying `admin_users` (officers).** Explicitly excluded. Officers keep their own
  identity — Google OAuth into admin.uscbia.com, `auth.users` → `admin_users` → role. It
  does **not** join the student account model, share onboarding, or appear on the account
  page. bia-admin still authors the migration and hosts `bia-shared` (it owns the schema),
  but the officer login itself is untouched. The unification is student web ↔ George only.
- Migrating `roommate_profiles` into the account model — listed as a follow-on, not core.

## Access model — free to use, login-gated writes

Browsing and using features stays **anonymous and free**. Login is required **only at the
moment of a write/persist action**, prompted just-in-time (a sheet at the point of action),
never a wall at the front door:

| Action | Login? |
|---|---|
| Browse roommate listings, search, read blog, **build** a schedule in the course planner | No |
| **Post** a roommate profile / event submission / sublet | Yes |
| **Save** a course-planner schedule to your account | Yes |
| View/edit your account page, link channels | Yes |

The payoff of the unified identity is exactly this seam: a student builds a schedule
anonymously, hits **Save**, logs in once (OTP/Google), and the schedule is written to their
`students` row — the same account George knows, so George can reference the saved schedule
later. Saving requires a new account-scoped table (`student_schedules`, RLS by
`user_id`) — none exists today.

Today `roommate_profiles` is written anonymously (`/submit`); under this model that write
becomes login-gated and the row is tied to `students.id`. Public reads are unchanged.

## Design principle

**One canonical record (`students`), many identity edges.** Keep `students` as the
account table — it already holds the profile, onboarding state, and the `link_code`
merge primitive. Add a web-auth edge alongside the existing chat edges. Web becomes a
**third platform**, not a new table.

```
                 ┌─────────────────────────────┐
   web login ───▶│           students          │◀─── iMessage handle
   (user_id →    │  id · name · major · year   │     (imessage_id)
    auth.users)  │  interests · notif_prefs    │
                 │  onboarding_complete        │◀─── WeChat OpenID
                 │  link_code (the bridge)     │     (wechat_open_id)
                 └─────────────────────────────┘
   email is read from auth.users via user_id — it is not a students column.
```

## 1. Identity model

**No new columns — the edge already exists.** Live `students` already has
`user_id uuid references auth.users(id)`, uniquely indexed (`students_user_id_uidx`). Email
is **not** a students column; it lives on `auth.users` and is read via `user_id` (the admin
users route already joins it that way). The account is keyed by **any** of `user_id` (web),
`imessage_id`, `wechat_open_id` today.

What's missing is the web side that populates `user_id`: mirror the existing chat
resolve-or-create (`george/src/db/students.ts:15-52`) for web — on first
authenticated web request, find the row by `user_id`; if absent, create one (server-side /
service role, race-safe via the unique index), exactly as George does for chat handles.

## 2. The web↔George handshake (extend `link_code`, don't reinvent)

George already has the merge primitive: `generateLinkCode` /`claimLinkCode`
(`george/src/db/students.ts:54-107`). A 6-digit, 10-minute code generated on
platform A is typed on platform B; the two rows merge (identity column copied to the
target, messages reassigned, claimer row deleted).

**Extend the same flow to `'web'`** by mapping the web platform to the existing `user_id`
column instead of a chat handle:

- Student is logged in on web but also talks to George on iMessage → from the account
  page, "Link my George" generates a code; they send it to George (or vice versa: ask
  George "link account", type the code on the web account page).
- `claimLinkCode` gains `'web'` in its platform union, mapping `platformColumn` to
  `user_id`. Everything else (expiry, self-link guard, message reassignment) is
  unchanged.

This is the elegant part: the bridge is already built and battle-tested for
WeChat↔iMessage. Web is one more edge on the same merge.

**Web is also a full chat platform, not only a link edge.** Because onboarding runs *as
George chat* on web (§5), `'web'` joins `'wechat'` / `'imessage'` everywhere George keys on
platform: the `messages.platform` check (`001_george_schema.sql:30`), the `resolveStudentId`
union (`src/db/students.ts:15`), and a new george-api web-chat endpoint that the bia-roommate
chat widget calls. The web platform id is the logged-in `user_id`, so
`resolveStudentId(authUserId, 'web')` finds/creates exactly the row §1 describes — no
separate keyspace.

## 3. Shared onboarding contract (kills drift)

Move the onboarding field set out of George's prompt and into `bia-shared` so George (the
sole onboarding writer) and the web account page import the **same** definition. Add to
`packages/bia-shared/src/types.ts`:

```ts
export type StudentYear = "freshman" | "sophomore" | "junior" | "senior" | "grad" | "unknown";
export type NotificationFrequency = "daily" | "weekly" | "special_only";

export interface NotificationPrefs {
  events: boolean;
  frequency: NotificationFrequency;
}

// Canonical account/member record. Same row whether reached via web login
// (user_id) or George (imessage_id / wechat_open_id).
export interface Student {
  id: string;
  user_id: string | null;   // web login edge -> auth.users.id (existing column)
  // email is NOT a students column — read from auth.users via user_id when needed
  wechat_open_id: string | null;
  imessage_id: string | null;
  name: string | null;
  major: string | null;
  year: StudentYear | null;
  interests: string[] | null;
  notification_prefs: NotificationPrefs;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
}

// The single onboarding contract. George's update_profile is the only onboarding
// writer; the web account page reads the same fields, enums, and completion rule.
export const ONBOARDING_REQUIRED_FIELDS = ["major", "year", "interests", "notification_prefs"] as const;
export type OnboardingField = (typeof ONBOARDING_REQUIRED_FIELDS)[number];

export function missingOnboardingFields(s: Partial<Student>): OnboardingField[] {
  const missing: OnboardingField[] = [];
  if (!s.major) missing.push("major");
  if (!s.year) missing.push("year");
  if (!s.interests || s.interests.length === 0) missing.push("interests");
  if (!s.notification_prefs?.frequency) missing.push("notification_prefs");
  return missing;
}

export function isOnboardingComplete(s: Partial<Student>): boolean {
  return missingOnboardingFields(s).length === 0;
}
```

Completion = **presence of all four fields** (placeholder values like `undecided` /
`unknown` count), which matches George's `update_profile` behavior today
(`george/src/tools/update-profile.ts`). George refactors to call
`isOnboardingComplete` instead of its private check. With web onboarding running *as
George* (§5) there is no second onboarding writer to keep in sync — the contract's job on
web is the **account page** (the field set, the enums, the "what's left" display) plus the
shared `Student` type.

bia-shared is consumed by bia-roommate from GitHub Packages; bumping it is the existing
publish path (`.github/workflows/publish-shared.yml`). george would add the dep
too (new consumer — see coordination below).

## 4. The account page (one page, same fields)

A single account page on web (bia-roommate, behind login) renders exactly the contract
fields plus linked channels:

- **Identity** — name, email, and connected channels: iMessage ✓ / WeChat ✓ / Web ✓,
  each with "link another" (the code flow from §2).
- **Profile** — major, year, interests (editable; same enums as the contract).
- **Notifications** — frequency (`daily` / `weekly` / `special_only`).
- **Onboarding status** — complete / what's missing, from `missingOnboardingFields`.

Edits write to `students`. George's `update_profile` writes the same columns. Because
it's one row, a change on either surface is reflected on the other with no sync.

## 5. Onboarding parity — one onboarding, rendered as George chat everywhere

There is exactly **one** onboarding implementation: George's 3-phase conversational flow
(intro → one question per turn → wrap-up,
`george/src/agent/personality.ts:567-647`). The web does **not** get a separate
form — it renders a **George chat** that runs the identical flow.

- **iMessage / WeChat**: unchanged.
- **Web**: a logged-in student gets an embedded George chat (platform `'web'`, keyed by
  `user_id`). The opening messages are George's onboarding — same code path, writing
  the same `students` row and the same `onboarding_complete`.

This is stronger than "two surfaces share a contract": it's *one onboarding logic on three
transports*, so it can't drift because it's never reimplemented. The cost is that web must
become a real George platform served by george-api (§2, Risks).

## 6. RLS / security (mostly already in place)

Verified live: RLS is **already enabled** on `students`, with a `read_own_student_row`
SELECT policy (`using (user_id = auth.uid())`). A logged-in student can already read their
own row; service-role clients (George, admin routes) bypass RLS and are unaffected.

What's **not** present is any write policy — by design. A blanket `update-own` policy would
let a student flip their own `onboarding_complete`, `member_id`, `link_code`, or reassign
`user_id`. So web writes (profile edit, linking, merges) stay **mediated**: a service-role
server action or a `security definer` RPC scoped to the editable profile columns
(`major`, `year`, `interests`, `notification_prefs`), consistent with how the admin app
already writes `students`. No raw client UPDATE on `students`.

## 7. Migration — what Phase 1 actually needs (verified against the live DB)

The foundation the original draft proposed (`user_id`, `email`, indexes, enable-RLS,
select-own) **already exists** in `ujkaregrwrppaehvbahf`:

| Original draft step | Live DB state |
|---|---|
| add `user_id` → auth.users | exists (`students_user_id_fkey`); 3 indexes (2 unique); 5/58 populated |
| add `email` | not needed — email is on `auth.users`, joined via `user_id` |
| add indexes on the edge | `students_user_id_uidx` etc. already present |
| `enable row level security` | already enabled |
| select-own policy | `read_own_student_row` already present |

**So Phase 1 requires no schema migration.** The identity foundation is done. The remaining
DB work for the unified account is *write-path* and belongs to later phases, not Phase 1:
- a `security definer` RPC for the constrained profile self-edit (Phase 5, account page);
- `'web'` added to the `messages.platform` (and reminder / proactive) CHECK constraints
  (Phase 4, web-as-George-platform);
- the `student_schedules` table (Phase 6).

If we instead decide web profile edits are **client-direct** (not a server action), the one
additive, safe migration would be a column-scoped grant + update policy:

```sql
-- OPTIONAL — only if web edits are client-direct rather than via a server action.
-- Authored in bia-admin (source of truth), applied via Supabase MCP.
grant update (major, year, interests, notification_prefs) on public.students to authenticated;
create policy update_own_student_profile on public.students
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

The column-scoped grant means that even with the row-level policy, a student can change only
those four profile columns — never `onboarding_complete`, `member_id`, or `user_id`.

## 8. Cross-repo coordination

| Repo | Change |
|---|---|
| **bia-admin** | Owns the schema — the identity foundation is already in place (§7), so no Phase-1 migration. Add the `Student` / onboarding contract to `bia-shared`, bump + publish. Later phases: the scoped profile-edit RPC (Phase 5) and the `'web'` platform CHECK migration (Phase 4). |
| **george** | Add `@biboyang425/bia-shared` dep; import the contract; replace private onboarding-complete check; add `'web'` to `claimLinkCode` platform union → `user_id`. |
| **bia-roommate** | Add student Supabase auth (OTP + Google OAuth), resolve-or-create `students` by `user_id`, an embedded George chat widget (web platform → george-api) for onboarding, account page, link-code UI. Bump bia-shared dep. |

## 9. Rollout phases

1. **Schema** — *already satisfied* (verified §7): `user_id`→auth.users, indexes, RLS, and
   the read-own policy all exist in the live DB. No migration needed unless we opt for
   client-direct profile edits (the optional grant+policy in §7).
2. **Contract** — `Student` + onboarding helpers in bia-shared; refactor George to import.
3. **Web auth** — phone-OTP login in bia-roommate (+ optional Google OAuth);
   resolve-or-create the `students` row on first authenticated request. An OTP that matches
   an existing `imessage_id` auto-links instead of creating a duplicate.
4. **Web as a George platform** — add `'web'` to george's platform checks +
   `resolveStudentId`; stand up a george-api web-chat endpoint + a chat widget in
   bia-roommate; onboarding runs as George chat keyed by `user_id`. (Critical-path
   dependency: george-api must be cloud-hosted — see Risks.)
5. **Account page** — view/edit + link-a-channel (code flow).
6. **Write-gates + saved schedules** — just-in-time login on post/save; new
   `student_schedules` table (account-scoped, RLS by `user_id`) so the course planner
   can persist a schedule to the account; gate existing posts (profile / event / sublet) on
   login. Depends on the course-planner feature, today docs-only
   (`docs/plans/2026-04-14-bia-course-helper-extension.md`).
7. **Follow-on** — tie `roommate_profiles` rows to `students.id` for logged-in submitters.

## 10. Decisions (locked 2026-06-17)

1. **Onboarding shape** — web onboarding **is** George's onboarding, embedded as a George
   chat. `'web'` becomes a full George platform (§2, §5). One implementation, zero drift.
2. **Canonical table** — keep **`students`**. Append-only columns, no rename, no george churn.
3. **Student auth** — **phone OTP + Google OAuth**. An OTP login on a number George already
   knows (`imessage_id`) auto-links web↔George; a Google-OAuth login (no phone) links via
   the 6-digit code flow (§2).
4. **Migration home** — **bia-admin** authors the schema (source of truth per CLAUDE.md);
   george reads the new columns.

## 11. Risks

- **Web onboarding requires george-api in the cloud.** Embedding George chat means
  bia-roommate calls george-api with the student's auth context (CORS + token passing), and
  george-api must be deployed (george-api.uscbia.com, still planned). iMessage George runs
  on a Mac; the web path needs the cloud deploy first — it is the critical-path dependency
  for Phase 4. If hosting slips, Phases 1-3 + 5 still land; only the live chat onboarding
  waits.
- **RLS is already enabled on `students`** (verified), with only `read_own_student_row`.
  All current `students` access in app code is service-role (admin API routes, george
  client), so it is unaffected. The watch-item is the reverse: do **not** add a broad
  `update-own` policy that exposes sensitive columns — keep writes mediated (§6).
- **Duplicate accounts** persist until linked. An OTP login on a number George already
  knows auto-merges; a **Google-OAuth** login (no phone) stays separate until the student
  runs the 6-digit code flow.
- **bia-shared becomes a george dependency** — george gains a coupling to the shared
  package's release cadence. Pin to a major; minor bumps stay backward-compatible.
