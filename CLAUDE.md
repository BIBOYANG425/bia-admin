# bia-admin (admin.uscbia.com)

@AGENTS.md

## About BIA

BIA is a student-led community starting from USC, exploring how humanity, technology, and art can reshape the way young people connect, experience, and belong.

We began with a simple observation: when someone enters a new school, a new city, or a new culture, what they lack is often not information, but a trusted way to make sense of it. There are endless posts, group chats, platforms, and recommendations. Yet the harder questions remain: What is worth going to? Who should I meet? Where do I start? How do I turn a place that feels unfamiliar into a life that feels like my own? **BIA exists to become that entry point.**

Rooted in the lived experience of international and Chinese-background students at USC, BIA is not just a social club, a tech club, or a traditional student organization. We are an experience-driven community that brings together lifestyle, creativity, technology, career exploration, and human connection. Community is not just about gathering people — it is about designing the conditions for meaningful encounters to happen.

Our work sits at the intersection of people, technology, and art:

- **Humanity is why we exist.** We care about belonging, identity, friendship, ambition, and the emotional experience of entering a new environment.
- **Technology is how we imagine new forms of connection.** Not a cold tool, but a way to make discovery, recommendation, and community more personal, intuitive, and alive.
- **Art is how we shape experience.** From visual identity to event atmosphere, from storytelling to spatial design, the way something feels is part of what makes it matter.

BIA starts at USC, but the questions are larger than one campus: How do young people find their place in a new environment? How do communities form in an age of fragmented attention? How can technology make human connection warmer rather than colder? How can art turn ordinary gatherings into experiences people remember?

We are not simply a club that hosts events — we are a living community platform that helps young people discover better experiences, meet the right people, and find more meaningful paths for growth. From USC to LA, from campus life to city culture, from one gathering to a longer sense of belonging, BIA is here to explore what the next generation of community can become.

## What this repo is

The admin dashboard at https://admin.uscbia.com plus the workspace home for `@biboyang425/bia-shared`. BIA officers (super_admin / editor / viewer roles) use this to manage:

- Blog CMS (draft → in_review → published state machine)
- Member invitations + role management
- Audit log
- Phase 3: shipping operations (parcels, shipments, pack-requests, routes, contacts)
- Phase 2: event submissions queue + sponsor management

This is also the **source of truth for the Supabase schema**. All migrations live in `supabase/migrations/` and apply to the live Supabase project (`ujkaregrwrppaehvbahf`) via the Supabase MCP or the Supabase CLI.

Local folder is named `BIA 新生service` for historical reasons. The GitHub repo is `bia-admin`. They are the same thing.

## What this repo is NOT

- **Not the public site.** That's bia-roommate at uscbia.com.
- **Not the George agent backend.** That's github.com/BIBOYANG425/george.
- **Not a place for consumer-facing UI.** Everything here assumes the visitor is an authenticated BIA officer with a row in `admin_users`. Routes are middleware-gated.

## The BIA platform (3 repos)

```
BIBOYANG425/bia-roommate           uscbia.com
  Next.js + Vercel. Landing + 新生services
  + blog + George UI pages + Chrome extension.

BIBOYANG425/george                 george-api.uscbia.com (planned)
  Express + Node. Agent backend. Runs on Mac
  for iMessage. Cloud-deployable without iMessage.

BIBOYANG425/bia-admin              admin.uscbia.com
  Next.js + Vercel. Officer dashboard.
  Blog CMS, member invitations, audit log,
  shipping ops. Hosts @biboyang425/bia-shared
  (types + Supabase clients + articles toolkit)
  and the canonical supabase/migrations folder.
  This repo.
```

Both bia-roommate and (when relevant) george install `@biboyang425/bia-shared` from GitHub Packages. The shared package is published from here via `.github/workflows/publish-shared.yml` on push to `main` when `packages/bia-shared/**` changes.

## How to run locally

```bash
pnpm install
cd bia-admin
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
EOF
pnpm dev
```

Visit http://localhost:3000. Sign in with Google OAuth. Your `auth.users` row must have a matching row in `admin_users` (with role `super_admin`, `editor`, or `viewer`) or middleware redirects to `/login?denied=not-invited`.

Shared package work:
```bash
cd packages/bia-shared
pnpm test
```

To publish: bump `packages/bia-shared/package.json` version, push to `main`. The workflow runs automatically. Consumers (bia-roommate, eventually george) then bump the dep version on their side.

## How to deploy

Vercel auto-deploys `bia-admin/` on push to `main` (configured as a separate Vercel project from bia-roommate, root = `bia-admin/`). Production = admin.uscbia.com.

Schema migrations workflow:

1. Write the migration SQL in `supabase/migrations/YYYYMMDDHHMMSS_what.sql`.
2. Apply via Supabase MCP `apply_migration` (preferred for short migrations) or `supabase migration up` for larger ones.
3. Update RLS policies in the same migration if the new table is anon-readable.
4. Test against the dev branch.
5. Verify production after merging.

## Guardrails

- **Schema migrations are append-only.** Never edit a migration that has been applied. Add a new one to amend.
- **Service role key never reaches the client.** Use only in API routes and server actions. The shared package's service-role client factory enforces this by living in a server-only export path.
- **Role enforcement is automatic.** Every route under `(admin)/` runs middleware that checks for an `admin_users` row. `withRole(role, handler)` wraps API routes. Don't bypass either.
- **Audit log is mandatory** for every state-changing admin action. Call `writeAudit({ admin_email, action, entity_type, entity_id, payload })` after the DB write. Failure to audit is a review blocker.
- **RLS first.** Assume any new table will be read by anon users via uscbia.com. Add RLS policies in the migration that creates the table. Default deny.
- **bia-shared breaking changes need a major version bump.** Don't push breaking changes to the shared package without bumping the major. Consumers pin to a major; minor bumps must stay backward compatible.
- **Don't commit `.env*` or secrets.** Vercel holds the production values.

## Cross-repo coordination

Changes here that require coordinated changes:

- **Migration affecting a table uscbia.com reads** → land migration here. Then update queries in bia-roommate.
- **Migration affecting a table george reads or writes** (students, messages, reminders, events) → land migration here. Then update DB helpers in george.
- **bia-shared major version bump** → update `@biboyang425/bia-shared` dep in bia-roommate and george.
- **New role added to `Role` enum** → ship in bia-shared first, bump version, update both consumers, then make role meaningful in `admin_users`.
- **Public blog comments** → `article_comments` is live and admin moderation (`/admin/comments`) ships here. bia-roommate builds the public form/list: anon `INSERT` with `status` forced `'visible'` (DB default — don't send it), `body` 1–2000, published-article enforced by RLS; anon `SELECT` returns only `status='visible'`. Type the public surface as `PublicArticleComment` from `@biboyang425/bia-shared/comments` (≥0.6.1) — never hand it the full `ArticleComment` (carries moderation fields). Rate-limit the POST per-IP; optional Turnstile.
- **Pickup QR** → the admin pickup desk (`/admin/shipping/pickup`) has a camera scanner that decodes the **bare 8-char `pickup_token`** and feeds the existing verify endpoint. bia-roommate must render each parcel's `pickup_token` as a QR (raw token text — no URL/JSON wrapper) on the student pickup view. The admin decoder is lenient (also tolerates `?t=<token>` / last-path-segment URLs or `{token}` JSON), but raw token is the agreed contract.

## BIA strategic context

BIA (Bridging Internationals Association) is a 1,500+ member international student community at USC, founded in 2024 (see **About BIA** above for the full positioning). It works at the intersection of humanity, technology, and art. Community reach: 3,500+ social followers, 80+ vetted cohort fellows across 4 interview-based rounds, 15+ flagship events per year.

When making technical decisions for this repo:

- **User-first.** Officers running this dashboard ARE the product team. Make their workflow fast.
- **Audit-friendly.** Every action that affects member data, blog state, or shipping ops needs to be traceable.
- **Conservative defaults.** This is the only repo with the Supabase service-role key. Bias toward stricter middleware, smaller blast radius, more confirmations on destructive operations.

## Workflow — Planning & Execution

Use gstack skills for all planning and execution:

- Before any multi-step work, invoke `/autoplan` or the relevant plan review skills (`/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`) to align on approach.
- For implementation, invoke `/superpowers:writing-plans` to write the plan, then `/superpowers:executing-plans` or `/superpowers:subagent-driven-development` to execute with parallel agents.
- For QA and shipping, invoke `/qa` to test, `/review` before landing, `/ship` to merge and deploy.
- For design work, invoke `/design-consultation` → `/design-shotgun` → `/design-html` pipeline.
- For debugging, invoke `/investigate` for systematic root cause analysis.

Always plan before building. Always review before shipping.

## Skill routing

When the user's request matches an available skill, use that skill's workflow before
answering directly. In Codex, read the matching skill from `.agents/skills/` and
follow its instructions. In Claude Code, use the corresponding slash command or
Claude skill from `.claude/skills/`.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
