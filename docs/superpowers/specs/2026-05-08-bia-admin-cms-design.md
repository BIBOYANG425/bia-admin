# BIA Admin & CMS — Design

**Date:** 2026-05-08
**Owner:** Bobby Yang
**Status:** Design rev 3 — ready for implementation
**Repos:** `BIA 新生service` (admin) · `bia-roommate` (uscbia.com — public)
**Companion:** `2026-05-08-bia-admin-cms-design.html` (visual version with mockups, diagrams, color swatches)

A SaaS-style dashboard at `admin.uscbia.com` that becomes the single home for all BIA admin — Blog, Events, Sponsors, Squad moderation, Members, plus the migrated 集运 ops. Public surfaces ship into uscbia.com, including replacing the placeholder cards on the landing-page Blog section with real database content.

---

## Contents

1. [Decisions at a glance](#1-decisions-at-a-glance)
2. [Architecture](#2-architecture)
3. [Auth & roles](#3-auth--roles)
4. [Data model](#4-data-model)
5. [Blog flow — the wedge](#5-blog-flow--the-wedge)
6. [BIA Events admin](#6-bia-events-admin)
7. [Sponsors](#7-sponsors)
8. [Squad moderation](#8-squad-moderation)
9. [集运 admin migration](#9-集运-admin-migration)
10. [Public surfaces (uscbia.com)](#10-public-surfaces-uscbiacom)
11. [Dashboard layout & UX](#11-dashboard-layout--ux)
12. [Aesthetic system](#12-aesthetic-system)
13. [Errors & testing](#13-errors--testing)
14. [Migrations, deployment, cutover](#14-migrations-deployment-cutover)
15. [Risks & mitigations](#15-risks--mitigations)
16. [Not in v1](#16-not-in-v1)

---

## 1. Decisions at a glance

| Topic | Decision |
|---|---|
| Architecture | Single bia-admin app at admin.uscbia.com |
| Admin lives in | `BIA 新生service/` repo |
| Public surfaces | Added to `bia-roommate` repo (uscbia.com) |
| Database | Same Supabase project (`ujkaregrwrppaehvbahf`), reuse + extend live tables |
| Auth | Google OAuth + email magic link via `@supabase/ssr` |
| Roles | `super_admin` · `editor` · `viewer` in new `admin_users` table |
| Blog source | Accept any HTML (Word, Notion, AI, hand-coded), normalize on server |
| Image handling | Zip / external URLs / base64 — all rehosted in Supabase Storage |
| Blog workflow | draft → in_review → published (super_admin only publishes) |
| Bilingual | CN and EN as separate posts |
| BIA Events | Officer CRUD + landing-page hero on uscbia.com |
| Sponsors | Internal records, logos surface on attached events only |
| Squad / 找搭子 | Existing user feature; admin gets moderation only |
| 集运 admin | Migrate existing `uscbia.com/admin/shipping/*` into bia-admin |
| Shell layout | Left sidebar with grouped sections (Content / Community / Operations / People) |
| Dashboard home | Per-section "what needs you today" attention cards |
| Blog editor | Split: drop+meta left, live preview right |
| Stack | Next.js 16 · shadcn/ui · TanStack Table+Query · React Hook Form + Zod · Sonner · Lucide |
| Visual | Neutral zinc/slate · BIA red (#990000) accent · Inter font |

---

## 2. Architecture

Two repos, two Vercel projects, one Supabase project.

### Repo 1 — `BIA 新生service/` (this repo, admin home)

```
BIA 新生service/                     # pnpm workspace root
├── bia-admin/                      # NEW Next.js 16 app
│   └── app/
│       ├── login/                  # Google OAuth + magic link
│       └── (admin)/                # middleware-gated route group
│           ├── blog/               # drop, edit, preview, publish (the wedge)
│           ├── events/             # BIA Events CRUD + submissions queue
│           ├── sponsors/           # CRUD + event attachment
│           ├── squad/              # moderation: hide/feature/delete
│           ├── shipping/           # MIGRATED from uscbia.com/admin/shipping
│           │   ├── routes/  contacts/  parcels/  pack-requests/
│           │   ├── requests/  shipments/  warehouses/
│           └── members/            # invite + role mgmt
│
├── packages/bia-shared/            # NEW workspace package
│   ├── types.ts                    # Article, Event, Sponsor, AdminUser, Role
│   ├── supabase.ts                 # browser/server/service-role factories
│   ├── html-sanitize.ts            # the upload pipeline
│   └── article-renderer.tsx        # prose renderer (admin preview + uscbia.com /blog reader)
│
├── supabase/migrations/            # NEW (canonical migrations live here)
└── pnpm-workspace.yaml             # NEW
```

### Repo 2 — `bia-roommate/` (uscbia.com, existing public site)

```
bia-roommate/                       # existing production site
└── app/
    ├── (existing) /, /squad, /sublet, /course-rating, …   # untouched
    │
    ├── blog/                       # NEW public reader
    │   ├── page.tsx                # /blog list
    │   └── [slug]/page.tsx         # /blog/[slug] reader
    │
    ├── events/                     # NEW (light) full BIA events list
    │   └── page.tsx
    │
    ├── (modify) page.tsx           # replace landing Blog placeholder + add Events hero
    ├── (modify) lib/i18n.ts        # drop hardcoded blog.posts; keep heading/byline
    ├── (modify) components/EventCard  # render attached sponsor logos
    └── (modify) app/squad/page.tsx # filter out hidden_at; pin featured

REMOVE after bia-admin reaches feature parity:
    ├── app/admin/                  # delete after cutover (now lives in bia-admin)
    └── components/admin/           # delete after cutover
```

### Deploy & data backbone

```
┌────────────────────────────┐  ┌────────────────────────────┐
│  uscbia.com                │  │  admin.uscbia.com          │
│  (existing public site)    │  │  (NEW · single admin)      │
│                            │  │                            │
│  + /blog, /blog/[slug]     │  │  shadcn shell + roles +    │
│  + landing Blog real posts │  │  middleware + service-role │
│  + Events hero on landing  │  │  in API routes             │
│  + sponsor logos on Event  │  │                            │
│  + squad filter for hidden │  │  Sections:                 │
│                            │  │   Blog · Events · Sponsors │
│  Auth: anon (RLS)          │  │   Squad mod · 集运 ·       │
│  Old /admin removed at     │  │   Members                  │
│  cutover                   │  │                            │
└─────────────┬──────────────┘  └─────────────┬──────────────┘
              │                               │
              │ anon read (RLS)               │ service-role write
              ▼                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Supabase project ujkaregrwrppaehvbahf  (UNCHANGED)     │
   │                                                         │
   │  EXISTING (39 tables):                                  │
   │    squad_posts · events · students · parcels ·          │
   │    shipments · pack_requests · admin_audit_log · …      │
   │                                                         │
   │  NEW: articles · sponsors · event_sponsors              │
   │       admin_users · admin_invitations                   │
   │  EXTEND: events (+slug, +rsvp_url, +draft state)        │
   │          squad_posts (+hidden_at, +is_featured if missing)│
   │  STORAGE: article-html (priv) · article-assets          │
   │           event-covers · sponsor-logos                  │
   └─────────────────────────────────────────────────────────┘
```

### Shared package distribution

The `@bia/shared` package built in repo 1 needs to be consumed by both apps. Three options, ordered by recommendation:

1. **Private GitHub Package** — `npm publish` to GitHub Packages, both repos add as dependency. Versioned, clean, ~30 min to set up. **Recommended.**
2. **Git submodule** — uscbia.com adds `BIA 新生service` as submodule, imports from a fixed path. Simpler but ugly and fragile.
3. **Duplicate types only** — copy `types.ts` to both, accept drift risk.

### Key invariants

- **Only the admin app holds the service-role key.** uscbia.com remains anon + RLS for the new tables.
- **Existing live data is preserved.** Nothing migrated, nothing destroyed (17 roommate profiles, 6 events, 1 parcel, 1 shipment, 1 pack_request, 48 students, 3 audit-log rows).
- **The shipping admin migration is UI-only.** Same Supabase, same tables, same business logic — just rebuilt with shadcn primitives + role-gated middleware in the new app.
- **One admin URL after cutover.** `uscbia.com/admin` gets a 301 redirect to `admin.uscbia.com` for the cutover window, then removed entirely.

---

## 3. Auth & roles

Three role tiers stored in a new `admin_users` table. Replaces the existing `isAdmin` boolean (which is what `uscbia.com/admin` uses today via `useAuth`).

### Three Supabase clients (in `packages/bia-shared/supabase.ts`)

| Factory | Used in | Privileges |
|---|---|---|
| `createBrowserClient()` | uscbia.com client components | anon · subject to RLS |
| `createServerClient(cookies)` | Both apps' server components & route handlers | session-scoped · subject to RLS |
| `createServiceRoleClient()` | **bia-admin only** · API routes after `requireRole()` passes | bypasses RLS · admin writes |

### Role capability matrix

| Capability | super_admin | editor | viewer |
|---|---|---|---|
| Read any dashboard data | ✓ | ✓ | ✓ |
| Create & edit drafts (blog, events, sponsors) | ✓ | ✓ | — |
| Submit blog posts for review | ✓ | ✓ | — |
| **Publish** (in_review → published, event draft → published) | ✓ | — | — |
| Mutate 集运 status workflow | ✓ | ✓ | — |
| Moderate squad posts | ✓ | ✓ | — |
| Invite/remove admins, change roles | ✓ | — | — |
| View audit log | ✓ | ✓ | ✓ |

### Onboarding flow

```
super_admin /admin/members → types email + role + Invite
        │
        ├──► admin_invitations row + email sent w/ one-time link
        ▼
invitee clicks link → /login (Google or magic link) → session cookie
        │
        ├──► /auth/callback resolves invite → admin_users row created
        │                                     with the invited role
        ▼
        invitation.accepted_at set → redirect to /admin
```

### Middleware gate (`bia-admin/middleware.ts`)

```
1. refreshSession(request)            // @supabase/ssr pattern
2. if (!session)                       return redirect("/login?return_to=...")
3. if (!adminUserRow(session.uid))     return redirect("/login?denied=not-invited")
4. attach role to request headers
5. return next()
```

### isAdmin → roles migration

Existing admins on uscbia.com (currently identified by `useAuth().isAdmin`) get seeded as `super_admin` in the new `admin_users` table. After cutover, uscbia.com's `useAuth().isAdmin` becomes vestigial (only `AdminShell` reads it; `AdminShell` is removed at cutover).

---

## 4. Data model

39 tables already exist in the live Supabase. We add 5, extend 1–2, leave the rest untouched.

| Table | Action | Notes |
|---|---|---|
| `articles` | **new** | HTML store, workflow state, slug, language. The wedge. |
| `sponsors` | **new** | Logo, name, website, tier, display_order, is_active |
| `event_sponsors` | **new** | Many-to-many (event ↔ sponsor) |
| `admin_users` | **new** | FK to `auth.users`, role enum, email mirror |
| `admin_invitations` | **new** | Email, role, invited_by, accepted_at |
| `events` | extend | `+slug`, `+rsvp_url`, `+'draft'` in status check |
| `squad_posts` | extend | `+hidden_at`, `+is_featured`, `+hidden_by` (only if missing — verify against live) |
| `pack_requests` · `parcels` · `parcel_events` · `shipments` · `pack_request_parcels` | reuse | 集运 stack — same tables, new admin UI talking to them |
| `shipping_routes` · `shipping_contacts` · `warehouse_addresses` · `shipping_notifications` | reuse | 集运 settings — same tables, new admin UI |
| `students` | reuse | 48 rows. Identity for 集运 customers. Read via FK. |
| `event_submissions` · `event_attendance` | reuse | Existing community-event submissions queue surfaces in BIA Events admin |
| `squad_members` · `squad_member_counts` | reuse | Squad join data; admin reads |
| `admin_audit_log` | reuse | Email-keyed. Every admin mutation appends here. |
| Existing `admin_indexes` and `admin_parcel_rpcs` migrations | reuse | Performance indexes + RPC helpers from PR #32. Stay in place. |
| `roommate_profiles` | keep | Untouched |
| ~24 others (courses, sublets, messages, instagram_accounts, george_jobs, …) | keep | Out of scope |

### `articles` table (the only complex new table)

```sql
create table articles (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                -- /blog/[slug] on uscbia.com
  title           text not null,
  language        text not null check (language in ('cn','en')),
  cover_image_url text,
  tags            text[] default '{}',
  author_id       uuid not null references admin_users(id),

  html_raw_path   text not null,                       -- private storage
  html_clean      text not null,                       -- sanitized HTML rendered to readers
  asset_paths     text[] default '{}',
  word_count      int,

  status          text not null default 'draft'
                  check (status in ('draft','in_review','published','unpublished')),
  submitted_at    timestamptz,  submitted_by   uuid references admin_users(id),
  published_at    timestamptz,  published_by   uuid references admin_users(id),
  unpublished_at  timestamptz,  unpublished_by uuid references admin_users(id),

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index articles_status_lang_idx on articles (status, language, published_at desc);
create unique index articles_slug_pub_idx on articles (slug) where status = 'published';
```

---

## 5. Blog flow — the wedge

Drop any HTML in the admin, get a published blog post on uscbia.com.

### Naming

- **DB table:** `articles` (clean, generic)
- **Admin path:** `/admin/blog`, `/admin/blog/new`, `/admin/blog/[id]`
- **Public path:** `/blog`, `/blog/[slug]` on uscbia.com
- **UI label:** "Blog" everywhere visitors and editors see it
- **Landing-page section:** "Latest Dispatches" / "最新动态" stays as the section heading; the three placeholder cards get replaced by real top-3 published posts

### The normalize pipeline (`packages/bia-shared/html-sanitize.ts`)

One function, idempotent, server-side. Runs in a transaction with the article insert. Lives in the shared package so admin (upload) and uscbia.com (revalidate-on-edit, if ever needed) can both call it.

```
┌──────────────┐  upload input
│ upload input │  .html · .zip · pasted clipboard text
└──────┬───────┘
       ▼
┌──────────────┐  unzip if needed → temp workspace with HTML + sibling images
│ 01 unzip     │
└──────┬───────┘
       ▼
┌──────────────┐  parse5 → DOM tree, no browser
│ 02 parse     │
└──────┬───────┘
       ▼
┌──────────────┐  drop <o:p>, <style>, MS Word junk, deprecated tags, comments
│ 03 strip     │
└──────┬───────┘
       ▼
┌──────────────┐  whitelist tags (h1-h4, p, ul/ol/li, blockquote, pre, code,
│ 04 whitelist │   a, em/strong, img, figure, table…); unwrap others
└──────┬───────┘
       ▼
┌──────────────┐  whitelist attrs (href, src, alt, title, colspan, rowspan)
│ 05 attrs     │   strip all style, class, id, on*
└──────┬───────┘
       ▼
┌──────────────┐  base64 → decode → upload to article-assets/, rewrite src
│ 06 images    │  ./local.png (zip) → match sibling → upload, rewrite
└──────┬───────┘  https://… → leave (v1.5: optional rehost flag)
       ▼
┌──────────────┐  DOMPurify defense-in-depth pass
│ 07 sanitize  │
└──────┬───────┘
       ▼
┌──────────────┐  title from first <h1> · cover from first <img>
│ 08 metadata  │  word_count from text content
└──────┬───────┘
       ▼
┌──────────────┐  slug from title · pinyin transliterate for CN
│ 09 slug      │  -2, -3 suffix on collision
└──────┬───────┘
       ▼
┌──────────────┐  { html_clean, title, cover_image_url, asset_paths, word_count }
│ 10 output    │
└──────────────┘
```

### Workflow state machine

```
draft → (submit) → in_review → (publish · super_admin) → published → (unpublish) → unpublished
  ↑                  │                                                              │
  └─ (re-edit) ──────┘                                                              │
                     │                                                              │
                     └─ (reject, super_admin) → draft                               │
                                                                                    │
                  unpublished → (republish, super_admin) → published ←──────────────┘
```

| Transition | Who | Effect |
|---|---|---|
| upload → draft | editor or super_admin | new row, status='draft' |
| draft → in_review | editor or super_admin | sets `submitted_at`, `submitted_by` |
| in_review → draft (reject) | super_admin | clears `submitted_at`; reason in audit log |
| in_review → published | **super_admin only** | sets `published_at`, `published_by`; slug becomes publicly readable |
| published → unpublished | super_admin | sets `unpublished_at`, `unpublished_by`; slug returns 404 |
| unpublished → published | super_admin | re-publishes (`published_at` updated) |
| any → re-upload | editor (drafts only) or super_admin (any state) | re-runs normalization, replaces `html_clean` and assets |

Every transition writes to `admin_audit_log` (entity_type='article', entity_id, action, payload jsonb).

### Editor surface — split view

- **Left pane:** drop zone, title, slug, language, tags, cover-image picker, status pill, action buttons
- **Right pane:** live preview rendered via the shared `<ArticleRenderer>` using cached `html_clean` + current metadata state. No server roundtrip per keystroke
- **Below 1024px:** collapses to single pane with a Source/Preview toggle

### Public reader (lives in uscbia.com)

- `app/blog/page.tsx` — list of published posts, filter by language & tag, paginated by `published_at desc`
- `app/blog/[slug]/page.tsx` — server component, renders `html_clean` via the shared `<ArticleRenderer>`, OG meta from title + cover. 404 if no published row matches.

### Landing-page integration (uscbia.com `app/page.tsx`)

```ts
// Replace the hardcoded blog.posts loop in the landing page Blog section.
// Server component fetch (or revalidate=60s SWR if kept client component):

const { data: latestPosts } = await supabase
  .from('articles')
  .select('slug, title, cover_image_url, language, published_at')
  .eq('status', 'published')
  .order('published_at', { ascending: false })
  .limit(3);

// Map into the existing tilted-card UI (preserve the rotation/offset
// design so the visual rhythm of the section stays the same).
// Drop blog.posts[] from lib/i18n.ts; keep blog.heading + blog.byline.
```

---

## 6. BIA Events admin

Officer-curated marketing events. Reuses live `events` table (5 BIA-source rows already there).

### Schema delta

```sql
alter table events add column slug text unique;
alter table events add column rsvp_url text;
alter table events drop constraint events_status_check;
alter table events add constraint events_status_check
  check (status in ('draft','published','active','cancelled','past'));
-- 'active' kept for back-compat with existing 6 rows; reader treats
-- 'active' as a synonym for 'published'.
```

### Admin pages

| Path | Job |
|---|---|
| `/admin/events` | Sortable filterable table — title, date, location, source badge, status, sponsor count. Top-right "+ New event". |
| `/admin/events/new` | Form: title, slug, date, end_date, location, description, cover, category, RSVP URL, is_featured, sponsor multi-select. |
| `/admin/events/[id]` | Edit existing. Sidebar: audit log, attached sponsors. "Cancel event" button. |
| `/admin/events/submissions` | Queue of `event_submissions where status='pending'` — Approve / Edit-then-approve / Reject. |

### uscbia.com surfaces

- **Landing page hero**: "Upcoming BIA Events" section above the existing roommate grid. Server component. Reads `events where source='bia' and status in ('published','active') and date >= now()` ordered ascending. Cards show cover, title, date, location, RSVP button, sponsor logos along the bottom.
- **`/events`**: full list page with all `source='bia'` events, filter by category. "View all" link from landing page hero.

---

## 7. Sponsors

Two new tables. Pure CRUD plus event attachment. No standalone public sponsors page in v1 — logos surface only on attached events.

```sql
create table sponsors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  logo_url      text not null,
  website_url   text,
  tier          text not null check (tier in ('event','recruiting','local','payment')),
  display_order int default 0,
  is_active     boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table event_sponsors (
  event_id   uuid references events(id) on delete cascade,
  sponsor_id uuid references sponsors(id) on delete cascade,
  primary key (event_id, sponsor_id)
);
create index event_sponsors_sponsor_idx on event_sponsors (sponsor_id);
```

- `/admin/sponsors` — table grouped by tier; drag-to-reorder updates `display_order`
- `/admin/sponsors/[id]` — form + sidebar showing attached events
- Storage: public bucket `sponsor-logos/{sponsor_id}/{filename}`
- uscbia.com event cards render attached sponsor logos via join from `event_sponsors`

---

## 8. Squad moderation

Squad / 找搭子 is already a live user feature on uscbia.com (squad_posts, squad_members, squad_member_counts, with a brutalist marquee UI on `/squad`). v1 adds officer moderation only. No redesign of the squad feature itself.

### Admin page

| Path | Job |
|---|---|
| `/admin/squad` | List of all squad posts. Filter: category (拼车/自习/约会/健身/游戏/其它), gender, status (active/hidden). Per row: poster name, contact, category badge, content snippet, photos count, max/current people, deadline. Actions: **Hide** (soft-delete, sets `hidden_at`), **Feature** (sets `is_featured` for surfacing on /squad top), **Delete** (hard delete + audit). Click → post detail with full content + member list. |

### Schema delta (only if missing)

```sql
-- Confirm against live schema before running. Add only if missing:
alter table squad_posts add column if not exists hidden_at timestamptz;
alter table squad_posts add column if not exists is_featured boolean default false;
alter table squad_posts add column if not exists hidden_by uuid references admin_users(id);

create index if not exists squad_posts_visibility_idx
  on squad_posts (hidden_at, is_featured desc, created_at desc);
```

### uscbia.com change

`app/squad/page.tsx` filter — exclude `hidden_at is not null`; pin `is_featured = true` to top. One-line query change, not a redesign.

---

## 9. 集运 admin migration

Move the existing `uscbia.com/admin/shipping/*` code (merged via PR #32) into bia-admin. Same Supabase, same tables, same business logic — new chrome (shadcn) and new auth (roles).

> **Note on production state.** The shipping feature is unannounced. The 1 parcel, 1 shipment, 1 pack_request rows in the live DB are test data, not real operations. No officers are running daily ops out of `uscbia.com/admin/shipping`. The migration is therefore a normal release, not a continuity-critical cutover. Parity tests still matter (don't ship a broken feature), but the operational risk goes away.

### What gets ported

| Existing path (uscbia.com) | New path (bia-admin) | Effort |
|---|---|---|
| `app/admin/shipping/contacts/page.tsx` | `app/(admin)/shipping/contacts/page.tsx` | L |
| `app/admin/shipping/pack-requests/page.tsx` | `app/(admin)/shipping/pack-requests/page.tsx` | L |
| `app/admin/shipping/parcels/page.tsx` + `[id]/page.tsx` | `app/(admin)/shipping/parcels/page.tsx` + `[id]/page.tsx` | M |
| `app/admin/shipping/requests/page.tsx` | `app/(admin)/shipping/requests/page.tsx` | S |
| `app/admin/shipping/routes/page.tsx` | `app/(admin)/shipping/routes/page.tsx` | L |
| `app/admin/shipping/shipments/page.tsx` + `[id]/page.tsx` | `app/(admin)/shipping/shipments/page.tsx` + `[id]/page.tsx` | L |
| `app/admin/users/{,/[id]}/page.tsx` | `app/(admin)/members/page.tsx` (renamed, also adds invite + role mgmt) | M |
| `components/admin/AdminShell.tsx` | Replaced by new shadcn-based shell — not literally ported | — |
| `components/admin/Field.tsx` | Replaced by shadcn form primitives | — |
| `app/api/admin/shipping/*` route handlers | `app/api/admin/shipping/*` in bia-admin | M (logic copy + role gate swap) |
| `supabase/migrations/20260422_admin_indexes.sql` | Stay in uscbia.com migrations folder; no re-run | — |
| `supabase/migrations/20260423_admin_parcel_rpcs.sql` | Stay in uscbia.com migrations folder; no re-run | — |

**Logic stays identical.** All these pages query the same Supabase tables (parcels, shipments, etc.) — only the UI primitives and auth gate change. Risk is in visual + interaction parity, not data semantics.

### What changes in the new home

- **Auth:** existing `useAuth().isAdmin` hook (uscbia.com) → middleware-gated route group with `requireRole()` (bia-admin)
- **Shell:** existing `AdminShell` using uscbia.com cream/serif palette → new shadcn shell using zinc/slate + BIA red accent
- **Forms:** existing `<Field>` custom inputs → React Hook Form + Zod + shadcn primitives
- **Tables:** existing custom tables → TanStack Table
- **Toasts:** existing toast pattern → Sonner

---

## 10. Public surfaces (uscbia.com)

| Surface | Action | Reads |
|---|---|---|
| `/blog` | NEW | `articles where status='published'` ordered `published_at desc` |
| `/blog/[slug]` | NEW | `articles where slug=$1 and status='published'` |
| `/events` | NEW (light) | `events where source='bia' and status in ('published','active')` |
| `/` landing — Blog section | MODIFY | Replace placeholder cards with top-3 latest published articles. Drop `blog.posts[]` from i18n; keep `blog.heading`/`blog.byline`. |
| `/` landing — Events hero | MODIFY | Add upcoming-events section reading next 3–5 events |
| `EventCard` component | MODIFY | Render attached sponsor logos along bottom |
| `/squad` | MODIFY (1-line) | Filter out `hidden_at is not null`; featured pinned to top |
| `/admin/*` | **REMOVE after cutover** | 301 redirect to admin.uscbia.com during cutover; delete after stable |

**No changes** to existing routes: roommate flows, course-rating, hackathon, sublet, account, auth, onboarding, usc-group, /集运 (lives in uscbia.com per shipping admin work).

---

## 11. Dashboard layout & UX

Three locked decisions from the visual companion brainstorm:

| Decision | Choice |
|---|---|
| Shell | Classic left sidebar with grouped sections (Content / Community / Operations / People), top breadcrumb |
| Dashboard home (`/admin`) | Per-section attention cards ("what needs you today") + quick actions row |
| Blog editor | Split: drop + metadata left, live preview right |

### Shell sidebar (6 items in 4 groups)

```
Content
  📰 Blog          (active)
  🗓 Events
  ⭐ Sponsors
Community
  👯 Squad mod
Operations
  📦 集运
People
  👥 Members
```

### Dashboard home — "what needs you today"

Per-section attention cards showing what's pending action, not just totals:

- **📰 Blog** — N posts in review · waiting on super_admin
- **🗓 BIA Events** — N community submissions pending
- **👯 Squad mod** — N posts flagged for review
- **📦 集运 requests** — N pending contact

Plus a "Quick actions" row with the most-common create buttons.

### Blog editor — split view

- **Left:** drop zone with file/zip/paste support, then form fields prefilled by the normalize pipeline (title, slug, language, tags, cover). Bottom: status pill, "Save draft" / "Submit for review" / "Preview" buttons.
- **Right:** live preview rendered via shared `<ArticleRenderer>`. State-only updates — no server roundtrip per keystroke. Re-upload triggers fresh normalize.
- **Mobile (< 1024px):** collapses to single pane with Source/Preview toggle.

---

## 12. Aesthetic system

### Color

| Token | Value | Usage |
|---|---|---|
| `--ink` | `#0A0A0B` | Primary text |
| `--slate-900` | `#27272A` | Sidebar background, secondary text |
| `--zinc-500` | `#71717A` | Tertiary text, muted labels |
| `--line` | `#E4E4E7` | Borders, dividers |
| `--bg-alt` | `#FAFAFA` | Surface alt (cards, table headers) |
| `--accent` | `#990000` | BIA red — primary CTAs, active states, focus rings |

**Status pills**: green (published / terminal-good), amber (in_review / pending), gray (draft), red (cancelled / hidden), blue (informational / new).

### Typography

- **Stack**: `Inter` primary (system fallback), `ui-monospace` for code/identifiers
- **H1**: 36/700, letter-spacing -0.02em
- **H2**: 24/700, letter-spacing -0.01em
- **H3**: 17/600
- **Body**: 15/400, line-height 1.55
- **Small**: 13/400
- **Mono**: 13

The article reader (uscbia.com) uses `Noto Serif SC` for editorial headings — that's a public-site choice we don't override in admin.

### Component principles

- **Density**: dense by default. Tables show 12–14 rows above the fold. Padding 8–12px in cells, 14–18px in cards.
- **Buttons**: primary (filled BIA red) and ghost (outlined neutral)
- **Inputs**: shadcn primitives, single border, focus ring in accent color
- **Tables**: TanStack Table — sortable headers, filter chips above, multi-select via row checkbox
- **Forms**: React Hook Form + Zod schema. Inline validation. Sticky "Save / Submit" footer on tall forms.
- **Toasts**: Sonner. Top-right. Auto-dismiss 4s. Errors stay until dismissed.
- **Empty states**: single sentence + primary CTA. No illustrations in v1.

---

## 13. Errors & testing

### Failure modes

| Surface | Failure | Behavior |
|---|---|---|
| HTML normalize | Malformed input | API 400 + `{stage, message, offendingNode}`; nothing persisted |
| HTML normalize | Storage upload mid-pipeline | API 500 + best-effort cleanup; full pipeline transactional |
| Auth | Session expired | Middleware → `/login?return_to=…`; TanStack Query auto-refetches |
| Auth | Signed in but not in admin_users | Middleware → `/login?denied=not-invited` |
| Auth | Editor hits publish endpoint | API 403 `error: 'role_required: super_admin'`; UI hides button server-side too |
| uscbia.com `/blog/[slug]` | Slug not published | 404 (RLS makes invisible) |
| uscbia.com landing Blog | Fewer than 3 published posts | Render however many exist; hide section if 0 |
| Squad mod | Hide non-existent post | API 404; toast in admin UI |
| 集运 migration | Old uscbia.com /admin link visited post-cutover | 301 redirect to admin.uscbia.com same path |
| Concurrent admin edit | Two editors save same row | Last write wins; audit log preserves both. Optimistic locking deferred to v1.5. |

### Testing

| Type | Scope |
|---|---|
| Unit (vitest) | `html-sanitize.ts` pipeline (every stage), `material-fields` helper, `audit-log` helper, slug generator (Chinese transliteration), tracking_slug uniqueness, `requireRole()` gate logic |
| Integration (vitest + Supabase test branch) | Full upload pipeline against a real Supabase storage bucket: drop fixture HTML → assert normalized output, asset URLs reachable, article row written |
| Manual smoke checklist | Per-feature in `bia-admin/docs/SMOKE.md`: 10-step walkthrough (invite → log in → upload → preview → submit → publish → see on public site → unpublish → verify 404) |
| Migration parity tests | Per-shipping-page checklist in `docs/SMOKE-shipping-parity.md`: same data, same actions, same field validation |
| **Not in v1** | E2E browser tests (Playwright). Match the bar PR #32 set: vitest + manual smoke. Add Playwright in v1.5 if regression rate justifies it. |

---

## 14. Migrations, deployment, cutover

Two-repo coordination. Phased rollout for shipping admin.

### Migrations (this repo)

```
BIA 新生service/supabase/migrations/
├── 00000000000000_baseline.sql                      # snapshot of live schema
├── 20260508000001_extend_events_for_admin.sql
├── 20260508000002_create_articles.sql
├── 20260508000003_create_sponsors_and_event_sponsors.sql
├── 20260508000004_create_admin_users_and_invitations.sql
├── 20260508000005_squad_moderation_columns.sql
├── 20260508000006_create_storage_buckets.sql
└── 20260508000007_rls_policies.sql
```

The baseline file uses `if not exists` clauses, safe to re-run. Each new migration is additive only — no destructive changes to live data.

### Deploy plan (sequenced)

1. **Phase 1 — Foundation.** Apply migrations to live Supabase. Build bia-admin shell (auth, middleware, AdminShell, login, members). Seed your `super_admin` row. Deploy at `bia-admin.vercel.app`.
2. **Phase 2 — New domains.** Build Blog, Events, Sponsors, Squad-mod inside bia-admin. Ship uscbia.com PR adding `/blog` + `/blog/[slug]` + landing-page Blog/Events surface + sponsor-logo render + squad `hidden_at` filter. Old `uscbia.com/admin/shipping` keeps existing for now (unannounced, no daily users to disrupt).
3. **Phase 3 — Shipping port.** Port shipping pages into bia-admin one section at a time (routes → contacts → warehouses → parcels → shipments → pack-requests → requests). Each section: ship → smoke parity test → mark "✓" in `SMOKE-shipping-parity.md`. (Shipping is unannounced — no parallel-running needed.)
4. **Phase 4 — Cleanup.** Once all shipping sections pass parity, deploy uscbia.com PR that removes `app/admin/*` and `components/admin/*`. No 301 redirects needed (no users have bookmarks). Point `admin.uscbia.com` DNS at the Vercel project. Done.

### Vercel projects

| App | Project | Repo + root | Env vars |
|---|---|---|---|
| uscbia.com | existing | uscbia.com repo | existing — anon only |
| bia-admin | **NEW** | this repo, root `bia-admin/` | + `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_JWT_SECRET` · Google OAuth client ID/secret |

### Workspace setup

```yaml
# pnpm-workspace.yaml at repo root
packages:
  - bia-admin
  - packages/*
```

Plus root `package.json` with workspace scripts, root `tsconfig.base.json` for shared compiler options. Fix `next.config.ts` `turbopack.root` per app (`__dirname` instead of hardcoded `/Users/mac`).

### Seed

```sql
insert into admin_users (id, email, role)
select id, email, 'super_admin'
  from auth.users where email = 'yangb7777@gmail.com'
on conflict (id) do nothing;
-- seed any existing isAdmin officers from uscbia.com here too
```

---

## 15. Risks & mitigations

### Risk 1 — Shipping migration regressions (downgraded)

Originally flagged as "ops disruption during migration." Reclassified after confirming the shipping feature is unannounced and has no daily users. Real risk is now just shipping a broken port: missing fields, off-by-one in status workflows, broken file uploads.

**Mitigation**: per-page parity smoke checklist (`SMOKE-shipping-parity.md`) before deleting the old code. No need for parallel-running, 301 redirects, or 48h monitoring — those were operational concerns that don't apply.

### Risk 2 — Auth model drift (isAdmin → roles) — downgraded

Original concern: officers using uscbia.com/admin can't be demoted from super_admin to editor mid-migration without breaking access. Reclassified after confirming admin has no daily users today.

**Mitigation**: seed yourself as `super_admin`. Add other officers directly into the new role model when you invite them — they never touch the old `isAdmin` system. The boolean becomes vestigial code that gets deleted at Phase 4.

### Risk 3 — Two admin URLs during transition — downgraded

Original concern: officers see two admin URLs during Phases 2–3 and need orientation banners. Reclassified after confirming shipping is unannounced — no officers are navigating either app daily.

**Mitigation**: skip banners. The only person navigating both during transition is you (the spec author). Onboard new officers directly to the bia-admin URL once Phase 1 ships.

### Risk 4 — Spec scope creep — accepted, mitigated by per-phase plans

This is rev 3. Rev 1 covered articles + auth + roles. Rev 2 added cross-repo split. Rev 3 added 集运 migration. The spec is intentionally broad to capture the full vision. Implementation must be broken into smaller plans.

**Mitigation**: when transitioning to `superpowers:writing-plans`, produce **four plan files** (one per phase) rather than one monolithic plan. Each phase ships independently and can be paused/reordered if priorities shift:

- `2026-05-08-bia-admin-phase1-foundation.md` — workspace, auth, members
- `2026-05-08-bia-admin-phase2-new-domains.md` — Blog, Events, Sponsors, Squad-mod, public surfaces on uscbia.com
- `2026-05-08-bia-admin-phase3-shipping-port.md` — port shipping pages from uscbia.com
- `2026-05-08-bia-admin-phase4-cleanup.md` — remove old admin from uscbia.com, DNS

---

## 16. Not in v1

Deliberately deferred. Each is a one-line decision, not a hidden assumption.

| Domain | Deferred |
|---|---|
| Blog | Revisions / edit history · Scheduled publish · Multilingual pairing · Comments · Auto cover from text · Rehost of external images · TOC / related |
| Events | Luma RSVP sync · Event detail page · Photo gallery + recap · Attendance tracking from admin UI |
| Sponsors | Public sponsors wall · Deal-status pipeline · Contact CRM · Deliverables checklist |
| Squad | Bulk moderation · Spam-detection ML · User-reporting flow ("report" button on /squad) |
| 集运 | Carrier API integration · Stripe/Alipay payments · Student login + order history · WeChat push on status change |
| Admin | E2E browser tests · Optimistic locking · Activity feed widget · Analytics dashboard |
| Other | Roommate-profile moderation · Sublet moderation · Course-review moderation |

---

**Companion HTML doc:** `2026-05-08-bia-admin-cms-design.html` in this directory — visual version with mockups, diagrams, color swatches, and side-by-side state machines.

**Next step:** transition to `superpowers:writing-plans` to produce per-phase implementation plans (Phase 1: Foundation, Phase 2: New domains, Phase 3: Shipping port, Phase 4: Cleanup).
