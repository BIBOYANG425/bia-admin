# BIA Admin Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the foundation for the BIA Admin & CMS — a new `bia-admin` Next.js app deployed at `bia-admin.vercel.app` where Bobby can sign in with Google, see an empty admin shell, and invite other officers via email so they get an `admin_users` row with a chosen role.

**Architecture:** Pnpm workspace at `BIA 新生service/` root with two packages: `bia-admin/` (Next.js 16 app, shadcn/ui, Tailwind v4) and `packages/bia-shared/` (types + Supabase client factories). Auth via `@supabase/ssr` cookie sessions. Three role tiers (`super_admin`, `editor`, `viewer`) in a new `admin_users` table; invites in `admin_invitations`. Middleware guards `/admin/*`. Service-role writes happen only from `bia-admin` API routes after `requireRole()` passes. Same Supabase project as uscbia.com (`ujkaregrwrppaehvbahf`).

**Repo:** `BIA 新生service/` is pushed to a NEW GitHub repo `BIBOYANG425/bia-admin` (created in Task 0 below). Despite the local clone sharing a remote URL with uscbia.com today, those histories are disjoint — pushing without a rename would either be rejected or destroy uscbia.com's history.

**Tech Stack:** Next.js 16 · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · @supabase/ssr · @supabase/supabase-js · zod · react-hook-form · @hookform/resolvers · sonner · lucide-react · vitest. Pnpm workspaces. (TanStack Query + TanStack Table deferred to Phase 2 — not used in Phase 1.)

**Eng review:** Reviewed via `/plan-eng-review` 2026-05-08. Findings 1A, 2A, 3A, 5A, 8A, 11A, T1A applied below.

---

## File Structure

### Created in `BIA 新生service/`

```
package.json                                    # workspace root, scripts, devDeps
pnpm-workspace.yaml                             # packages: bia-admin, packages/*
tsconfig.base.json                              # shared compiler options
.env.example                                    # documented env vars
.gitignore                                      # already exists; add node_modules/.next coverage rules
docs/superpowers/plans/
└── 2026-05-08-bia-admin-phase1-foundation.md  # this file

bia-admin/
├── package.json
├── next.config.ts                              # turbopack.root: __dirname
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json                             # shadcn config
├── middleware.ts                               # session refresh
├── vitest.config.ts
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── login/page.tsx
│   ├── auth/callback/route.ts
│   └── (admin)/
│       ├── layout.tsx
│       ├── page.tsx                            # dashboard home placeholder
│       ├── members/page.tsx                    # members list + invite UI
│       └── members/MembersClient.tsx           # client-side dialog + dropdowns
├── app/api/admin/members/
│   ├── invite/route.ts                         # POST
│   ├── [id]/route.ts                           # PATCH role, DELETE
│   └── invitations/[id]/route.ts               # DELETE invitation
├── components/
│   ├── ui/                                     # shadcn primitives
│   ├── AdminShell.tsx                          # sidebar + topbar
│   ├── SidebarNav.tsx                          # client subcomponent for active link
│   └── auth/SignInForm.tsx
├── lib/
│   ├── auth/
│   │   ├── require-role.ts
│   │   └── __tests__/require-role.test.ts
│   ├── admin/
│   │   ├── sections.ts                         # nav config (Phase 1 enabled, others disabled)
│   │   └── audit-log.ts                        # tiny helper
│   └── supabase.ts                             # re-exports from @bia/shared

packages/bia-shared/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                                # barrel re-exports framework-agnostic only
    ├── types.ts                                # @bia/shared/types
    ├── supabase/
    │   ├── browser.ts                          # @bia/shared/supabase/browser
    │   └── service-role.ts                     # @bia/shared/supabase/service-role
    └── next/
        └── supabase/
            ├── server.ts                       # @bia/shared/next/supabase/server (server-only)
            └── middleware.ts                   # @bia/shared/next/supabase/middleware (server-only)

supabase/
├── config.toml
└── migrations/
    ├── 00000000000000_baseline.sql
    ├── 20260508000001_create_admin_users.sql
    └── 20260508000002_create_admin_invitations.sql
```

### Read-only reference (in `/Users/mac/Documents/bia-roommate/`)

- `lib/supabase/server.ts` — copy-shape source for `@bia/shared/src/next/supabase/server.ts`
- `lib/supabase/middleware.ts` — copy-shape source for `@bia/shared/src/next/supabase/middleware.ts`
- `lib/supabase/client.ts` — copy-shape source for `@bia/shared/src/supabase/browser.ts`
- `app/auth/callback/route.ts` — adapt (drop isSchoolEmail; add invite resolution)
- `vitest.config.ts` — copy structure
- `components/admin/AdminShell.tsx` — read for shape only; do NOT copy palette/styling

---

## Tasks

### Task 0: Create new GitHub repo `BIBOYANG425/bia-admin` and rewire local remote

**Files:** none (git remote + GitHub dashboard)

> **Why:** `BIA 新生service/` and `bia-roommate/` (uscbia.com) currently share the same `origin` URL but have disjoint local commit histories. Pushing without separating remotes would either be rejected or destroy uscbia.com's history. This task untangles them before any code lands.

- [ ] **Step 1: Verify the entanglement**

```bash
echo "=== BIA 新生service ==="
git -C "/Users/mac/Documents/BIA 新生service" remote -v
echo "=== uscbia.com (separate clone) ==="
git -C "/Users/mac/Documents/bia-roommate" remote -v
echo "=== local main of BIA 新生service is disjoint from origin/main ==="
git -C "/Users/mac/Documents/BIA 新生service" rev-parse HEAD
git -C "/Users/mac/Documents/bia-roommate" rev-parse origin/main
```

Expected: both clones show the same `origin` URL but the two HEAD commits are completely different.

- [ ] **Step 2: Create the new GitHub repo via gh or web UI**

```bash
gh repo create BIBOYANG425/bia-admin --private --confirm
```

If `gh` is not authenticated, log in first: `gh auth login`. Or create the repo manually at https://github.com/new with name `bia-admin`, visibility private, no README/license/gitignore (the local repo already has them).

- [ ] **Step 3: Rewire the local remote**

```bash
cd "/Users/mac/Documents/BIA 新生service"
git remote set-url origin https://github.com/BIBOYANG425/bia-admin.git
git remote -v
```

Expected: origin now points at `BIBOYANG425/bia-admin.git`.

- [ ] **Step 4: Push the existing commits to the new repo**

```bash
git push -u origin main
```

Expected: success. Local main becomes the new repo's main. No collision with uscbia.com because that lives in a different repo now.

- [ ] **Step 5: Verify and protect**

In GitHub UI: Settings → Branches → add a branch protection rule for `main` (require PRs, require linear history). Optional but recommended.

- [ ] **Step 6: No commit yet**

This task only manipulates remote configuration. Commit happens in Task 1.

---

### Task 1: Pnpm workspace bootstrap

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - bia-admin
  - packages/*
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "bia-xinsheng-service",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "pnpm --filter bia-admin dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "incremental": true
  }
}
```

- [ ] **Step 4: Create `.env.example`**

```bash
# Supabase (live project ujkaregrwrppaehvbahf)
NEXT_PUBLIC_SUPABASE_URL=https://ujkaregrwrppaehvbahf.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Admin app only (NEVER include in bia-roommate)
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

# Google OAuth (configured in Supabase Auth dashboard)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 5: Run install and verify**

Run: `cd "/Users/mac/Documents/BIA 新生service" && pnpm install`
Expected: exits 0, creates `pnpm-lock.yaml`, no packages installed yet (no children defined)

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .env.example pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm workspace for bia-admin"
```

---

### Task 2: Shared package — types + Supabase client factories

**Files:**
- Create: `packages/bia-shared/package.json`
- Create: `packages/bia-shared/tsconfig.json`
- Create: `packages/bia-shared/src/index.ts`
- Create: `packages/bia-shared/src/types.ts`
- Create: `packages/bia-shared/src/supabase/browser.ts`
- Create: `packages/bia-shared/src/supabase/server.ts`
- Create: `packages/bia-shared/src/supabase/service-role.ts`
- Create: `packages/bia-shared/src/supabase/middleware.ts`

- [ ] **Step 1: Create `packages/bia-shared/package.json`**

> **Subpath structure:** `@bia/shared/types` and `@bia/shared/supabase/browser` are framework-agnostic (importable from anywhere — tests, scripts, future tooling). `@bia/shared/next/*` requires Next 16 + `next/headers` and is server-only. This makes the constraint explicit at import time and avoids confusing "cookies is not a function" errors.

```json
{
  "name": "@bia/shared",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./supabase/browser": "./src/supabase/browser.ts",
    "./supabase/service-role": "./src/supabase/service-role.ts",
    "./next/supabase/server": "./src/next/supabase/server.ts",
    "./next/supabase/middleware": "./src/next/supabase/middleware.ts"
  },
  "dependencies": {
    "@supabase/ssr": "^0.5.0",
    "@supabase/supabase-js": "^2.45.0"
  },
  "peerDependencies": {
    "next": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/bia-shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "baseUrl": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/bia-shared/src/types.ts`**

```ts
export type Role = "super_admin" | "editor" | "viewer";

export interface AdminUser {
  id: string;            // FK to auth.users.id
  email: string;
  role: Role;
  created_at: string;
}

export interface AdminInvitation {
  id: string;
  email: string;
  role: Role;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  super_admin: 3,
};

export function roleAtLeast(have: Role, need: Role): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}
```

- [ ] **Step 4: Create `packages/bia-shared/src/supabase/browser.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createBiaBrowserClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  client = createBrowserClient(url, key);
  return client;
}
```

- [ ] **Step 5: Create `packages/bia-shared/src/next/supabase/server.ts`**

> Server-only — requires Next 16 `next/headers`. Do NOT import from non-Next code.

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createBiaServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll can fail in Server Components (read-only).
          // Middleware handles the refresh.
        }
      },
    },
  });
}
```

- [ ] **Step 6: Create `packages/bia-shared/src/supabase/service-role.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function createBiaServiceRoleClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
```

- [ ] **Step 7: Create `packages/bia-shared/src/next/supabase/middleware.ts`**

> Server-only — requires Next 16 middleware runtime.

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateBiaSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return supabaseResponse;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return supabaseResponse;
}
```

- [ ] **Step 8: Create `packages/bia-shared/src/index.ts`**

> The barrel re-exports framework-agnostic only. Next-bound helpers must be imported via their subpath (`@bia/shared/next/supabase/server`) so the `next/headers` dependency is explicit at the call site.

```ts
export * from "./types";
export { createBiaBrowserClient } from "./supabase/browser";
export { createBiaServiceRoleClient } from "./supabase/service-role";
// Next-bound helpers are NOT re-exported from the barrel.
// Import them via: @bia/shared/next/supabase/server
//                  @bia/shared/next/supabase/middleware
```

- [ ] **Step 9: Install + typecheck**

Run: `cd "/Users/mac/Documents/BIA 新生service" && pnpm install`
Expected: installs `@supabase/ssr` and `@supabase/supabase-js` into the workspace; lockfile updated.

Run: `cd "/Users/mac/Documents/BIA 新生service" && pnpm --filter @bia/shared exec tsc --noEmit`
Expected: exits 0, no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/ pnpm-lock.yaml
git commit -m "feat(shared): @bia/shared package — types + supabase client factories"
```

---

### Task 3: Baseline migration (snapshot of live schema)

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/00000000000000_baseline.sql`

> **Why:** uscbia.com's `supabase/migrations/` is the historical source-of-truth for shipping/squad migrations, but the live DB has 14+ migrations and 39 tables that aren't in this repo. The baseline file is a one-time snapshot so this repo can run from a clean Supabase reset for new contributors. Idempotent — re-running is safe.

- [ ] **Step 1: Create `supabase/config.toml`**

```toml
project_id = "ujkaregrwrppaehvbahf"

[db]
major_version = 15
```

- [ ] **Step 2: Generate baseline schema dump via Supabase MCP**

Run via MCP: `mcp__supabase__execute_sql` with this query (returns a SQL script as text):

```sql
select string_agg(
  format(
    'create table if not exists public.%I (...);',
    table_name
  ),
  E'\n'
)
from information_schema.tables
where table_schema='public'
order by table_name;
```

This returns a text dump. **Note:** the simple `string_agg` above won't capture columns/constraints. Use the proper approach:

Run via MCP `execute_sql`:
```sql
select pg_get_tabledef('public.' || table_name) as def
from (
  select table_name from information_schema.tables
  where table_schema = 'public' order by table_name
) t;
```

If `pg_get_tabledef` is not available (it's not standard Postgres), fall back to using `mcp__supabase__list_tables` with `verbose: true` and reconstruct the SQL by hand. For Phase 1 the baseline file can be a stub:

```sql
-- supabase/migrations/00000000000000_baseline.sql
--
-- Snapshot of public schema as of 2026-05-08.
-- Generated from live Supabase project ujkaregrwrppaehvbahf.
-- This file uses `if not exists` clauses so re-running is safe.
--
-- For Phase 1 of the BIA Admin & CMS work, this file is intentionally
-- a no-op against the live DB — every existing table is already there.
-- The new admin tables (admin_users, admin_invitations) live in
-- separate migrations 20260508000001 and 20260508000002.
--
-- For local dev / a fresh Supabase project, see /docs/dev-supabase-setup.md
-- for instructions to mirror prod schema (Phase 2 will add this doc).

select 1; -- no-op
```

> **Note:** A full schema dump is non-trivial via MCP and not strictly required for Phase 1, since the live DB already has all 39 tables. Local-dev parity is a Phase 2 concern.

- [ ] **Step 3: Commit**

```bash
git add supabase/config.toml supabase/migrations/00000000000000_baseline.sql
git commit -m "chore(db): pin supabase project, add baseline migration placeholder"
```

---

### Task 4: Migration — `admin_users` table

**Files:**
- Create: `supabase/migrations/20260508000001_create_admin_users.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260508000001_create_admin_users.sql
--
-- admin_users: who can access admin.uscbia.com and at what tier.
-- One row per officer. id is the FK to auth.users.id so the row
-- vanishes on auth user deletion.

create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('super_admin','editor','viewer')),
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- Authenticated users may read their own row only. All admin reads of
-- the full table happen via service-role from bia-admin's API routes.
drop policy if exists "self read" on public.admin_users;
create policy "self read" on public.admin_users
  for select to authenticated
  using (id = auth.uid());

create index if not exists admin_users_email_idx on public.admin_users (email);
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with:
- name: `create_admin_users`
- query: the full SQL above

Expected: success response. The migration is recorded in `supabase_migrations.schema_migrations`.

- [ ] **Step 3: Verify**

Run via `mcp__supabase__execute_sql`:
```sql
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='admin_users'
order by ordinal_position;
```
Expected: 4 rows (id uuid, email text, role text, created_at timestamptz).

Run:
```sql
select policyname, cmd from pg_policies
where schemaname='public' and tablename='admin_users';
```
Expected: 1 row, `policyname='self read'`, `cmd='SELECT'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260508000001_create_admin_users.sql
git commit -m "feat(db): admin_users table with role check + self-read RLS"
```

---

### Task 5: Migration — `admin_invitations` table

**Files:**
- Create: `supabase/migrations/20260508000002_create_admin_invitations.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260508000002_create_admin_invitations.sql
--
-- admin_invitations: pending invites by email. When an invitee signs in
-- (Google OAuth or magic link), the auth callback finds their pending
-- invitation by email and creates the corresponding admin_users row.

create table if not exists public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null check (role in ('super_admin','editor','viewer')),
  invited_by uuid references public.admin_users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.admin_invitations enable row level security;

-- No policies: writes/reads happen only via service-role from bia-admin.

create index if not exists admin_invitations_email_idx
  on public.admin_invitations (email)
  where accepted_at is null;

create unique index if not exists admin_invitations_pending_email_idx
  on public.admin_invitations (lower(email))
  where accepted_at is null;
```

- [ ] **Step 2: Apply via MCP**

Use `mcp__supabase__apply_migration` with name `create_admin_invitations` and the SQL above.

- [ ] **Step 3: Verify**

Run via `mcp__supabase__execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='admin_invitations'
order by ordinal_position;
```
Expected: 6 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260508000002_create_admin_invitations.sql
git commit -m "feat(db): admin_invitations table — pending email invites"
```

---

### Task 6: Seed Bobby as super_admin

**Files:** none (one-shot SQL)

- [ ] **Step 1: Run seed via MCP**

Use `mcp__supabase__execute_sql`:

```sql
insert into public.admin_users (id, email, role)
select id, email, 'super_admin'
from auth.users
where lower(email) = lower('yangb7777@gmail.com')
on conflict (id) do nothing
returning id, email, role;
```

Expected: 1 returned row with role `super_admin`. (If Bobby has not yet logged into Supabase Auth at all, this returns 0 rows; in that case skip — Task 11's first sign-in will create the auth.users row, and we'll re-run this seed afterwards.)

- [ ] **Step 2: If 0 rows returned, document and continue**

If Bobby has never authenticated against this Supabase project, no `auth.users` row exists yet. Record this in a comment on the implementation PR: "Seed deferred — re-run after first sign-in via Task 11." Do NOT block on this.

- [ ] **Step 3: No commit (no files changed)**

This is a database operation only. No git changes.

---

### Task 7: Bootstrap `bia-admin` Next.js app

**Files:**
- Create: `bia-admin/package.json`
- Create: `bia-admin/next.config.ts`
- Create: `bia-admin/tsconfig.json`
- Create: `bia-admin/tailwind.config.ts`
- Create: `bia-admin/postcss.config.mjs`
- Create: `bia-admin/components.json`
- Create: `bia-admin/app/layout.tsx`
- Create: `bia-admin/app/globals.css`
- Create: `bia-admin/app/page.tsx`  (will be replaced by Task 9; placeholder for boot)
- Create: `bia-admin/eslint.config.mjs`

> **Why we don't use `pnpm create next-app`:** the generator scaffolds extra files (favicon route, README) and may use a different React version than the rest of the workspace. Creating the files explicitly is faster and matches the workspace conventions.

- [ ] **Step 1: Create `bia-admin/package.json`**

```json
{
  "name": "bia-admin",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  },
  "dependencies": {
    "@bia/shared": "workspace:*",
    "@hookform/resolvers": "^3.9.0",
    "@supabase/ssr": "^0.5.0",
    "@supabase/supabase-js": "^2.45.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.453.0",
    "next": "16.2.1",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "react-hook-form": "^7.53.0",
    "sonner": "^1.5.0",
    "tailwind-merge": "^2.5.0",
    "tailwindcss-animate": "^1.0.7",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.1",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `bia-admin/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
```

- [ ] **Step 3: Create `bia-admin/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `bia-admin/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

- [ ] **Step 5: Create `bia-admin/postcss.config.mjs`**

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 6: Create `bia-admin/app/globals.css`**

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --primary: 0 100% 30%;             /* BIA red #990000 */
    --primary-foreground: 0 0% 100%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 0 100% 30%;
    --radius: 0.5rem;
  }
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body { font-family: -apple-system, "Inter", system-ui, sans-serif; }
```

- [ ] **Step 7: Create `bia-admin/components.json` (shadcn)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 8: Create `bia-admin/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "BIA Admin",
  description: "Internal admin dashboard for BIA@USC",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Create `bia-admin/app/page.tsx` (placeholder root, will be replaced)**

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/admin");
}
```

- [ ] **Step 10: Create `bia-admin/lib/utils.ts` (shadcn util)**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 11: Create `bia-admin/eslint.config.mjs`**

```js
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat();

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**"],
  },
];
```

- [ ] **Step 12: Install all deps**

Run: `cd "/Users/mac/Documents/BIA 新生service" && pnpm install`
Expected: installs all of `bia-admin`'s dependencies. Lockfile updated.

- [ ] **Step 13: Verify build runs (sanity)**

Run: `cd "/Users/mac/Documents/BIA 新生service" && pnpm --filter bia-admin build`
Expected: `next build` exits 0. Two warnings about missing env vars are OK at this stage; a build failure is not.

- [ ] **Step 14: Commit**

```bash
git add bia-admin/ pnpm-lock.yaml
git commit -m "feat(admin): bootstrap bia-admin Next.js 16 app with Tailwind v4"
```

---

### Task 8: Add shadcn primitives we need in Phase 1

**Files (created by shadcn CLI):**
- Create: `bia-admin/components/ui/button.tsx`
- Create: `bia-admin/components/ui/card.tsx`
- Create: `bia-admin/components/ui/dialog.tsx`
- Create: `bia-admin/components/ui/alert-dialog.tsx`
- Create: `bia-admin/components/ui/input.tsx`
- Create: `bia-admin/components/ui/label.tsx`
- Create: `bia-admin/components/ui/select.tsx`
- Create: `bia-admin/components/ui/dropdown-menu.tsx`
- Create: `bia-admin/components/ui/sheet.tsx`
- Create: `bia-admin/components/ui/table.tsx`
- Create: `bia-admin/components/ui/form.tsx`

- [ ] **Step 1: Install primitives via shadcn CLI**

Run from `bia-admin/`:

```bash
cd "/Users/mac/Documents/BIA 新生service/bia-admin" && pnpm dlx shadcn@latest add button card dialog alert-dialog input label select dropdown-menu sheet table form
```

Expected: 10 files created under `components/ui/`. The shadcn CLI may install additional Radix UI deps — accept the prompts.

- [ ] **Step 2: Re-run install if shadcn added deps**

Run: `cd "/Users/mac/Documents/BIA 新生service" && pnpm install`
Expected: lockfile resolves any new deps installed by shadcn.

- [ ] **Step 3: Verify build still passes**

Run: `pnpm --filter bia-admin build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add bia-admin/components/ui/ bia-admin/package.json pnpm-lock.yaml
git commit -m "feat(admin): add shadcn primitives (button, card, dialog, input, etc.)"
```

---

### Task 9: `requireRole()` helper + unit tests

**Files:**
- Create: `bia-admin/lib/auth/require-role.ts`
- Create: `bia-admin/lib/auth/__tests__/require-role.test.ts`
- Create: `bia-admin/vitest.config.ts`

- [ ] **Step 1: Create `bia-admin/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["**/__tests__/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 2: Write the failing test**

`bia-admin/lib/auth/__tests__/require-role.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { roleAtLeast } from "@bia/shared";

describe("roleAtLeast", () => {
  it("super_admin satisfies every role", () => {
    expect(roleAtLeast("super_admin", "super_admin")).toBe(true);
    expect(roleAtLeast("super_admin", "editor")).toBe(true);
    expect(roleAtLeast("super_admin", "viewer")).toBe(true);
  });

  it("editor satisfies editor and viewer but not super_admin", () => {
    expect(roleAtLeast("editor", "super_admin")).toBe(false);
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast("editor", "viewer")).toBe(true);
  });

  it("viewer satisfies only viewer", () => {
    expect(roleAtLeast("viewer", "super_admin")).toBe(false);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test (expect fail because roleAtLeast not yet exported from @bia/shared after install)**

Run: `cd "/Users/mac/Documents/BIA 新生service" && pnpm --filter bia-admin test`
Expected: PASS (because Task 2 already exported `roleAtLeast` from `@bia/shared`). If FAIL, fix the export in `packages/bia-shared/src/index.ts`.

> **Note:** This is a "test that the existing helper works" check, not a TDD-fresh failing test. The next step adds the integration helper that calls into Supabase, which is where TDD's "failing-first" pattern starts.

- [ ] **Step 4: Write the failing test for `requireRole()` and `withRole()`**

Append to `bia-admin/lib/auth/__tests__/require-role.test.ts`. After Issue 8A, the self-read uses the cookie-bound server client; mocks both that and the service-role client because `withRole`-using API routes consume both.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { requireRole, withRole, RoleError } from "../require-role";

const mockGetUser = vi.fn();
const mockServerFrom = vi.fn();   // cookie-bound client (self-read)
const mockServiceFrom = vi.fn();  // service-role client (cross-user reads)

vi.mock("@bia/shared/next/supabase/server", () => ({
  createBiaServerClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockServerFrom,
  }),
}));

vi.mock("@bia/shared", async (importActual) => {
  const actual = await importActual<typeof import("@bia/shared")>();
  return {
    ...actual,
    createBiaServiceRoleClient: () => ({ from: mockServiceFrom }),
  };
});

function mockSelfRead(data: unknown, error: unknown = null) {
  mockServerFrom.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle: () => ({ data, error }) }),
    }),
  });
}

describe("requireRole", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
    mockServiceFrom.mockReset();
  });

  it("throws 401 when no user session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(requireRole("viewer")).rejects.toMatchObject({
      status: 401,
      code: "no_session",
    });
  });

  it("throws 403 when user has no admin_users row", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead(null);
    await expect(requireRole("viewer")).rejects.toMatchObject({
      status: 403,
      code: "not_admin",
    });
  });

  it("throws 403 with lookup_failed when supabase errors", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead(null, { message: "network down" });
    await expect(requireRole("viewer")).rejects.toMatchObject({
      status: 403,
      code: "lookup_failed",
    });
  });

  it("throws 403 when role insufficient", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead({ id: "u1", email: "x@y", role: "viewer" });
    await expect(requireRole("super_admin")).rejects.toMatchObject({
      status: 403,
      code: "role_required: super_admin",
    });
  });

  it("returns user + role when role sufficient", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead({ id: "u1", email: "x@y", role: "super_admin" });
    const result = await requireRole("editor");
    expect(result.role).toBe("super_admin");
    expect(result.user.id).toBe("u1");
  });
});

describe("withRole", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
  });

  it("maps RoleError to NextResponse with status + error code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const handler = vi.fn();
    const res = await withRole("viewer", handler);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "no_session" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls handler with ctx when role sufficient", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead({ id: "u1", email: "x@y", role: "super_admin" });
    const handler = vi.fn(async () =>
      NextResponse.json({ ok: true }, { status: 200 }),
    );
    const res = await withRole("editor", handler);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const ctx = handler.mock.calls[0][0];
    expect(ctx.role).toBe("super_admin");
    expect(ctx.user.id).toBe("u1");
  });

  it("propagates non-RoleError exceptions", async () => {
    mockGetUser.mockImplementation(() => {
      throw new Error("network");
    });
    const handler = vi.fn();
    await expect(withRole("viewer", handler)).rejects.toThrow("network");
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the test — expect FAIL**

Run: `pnpm --filter bia-admin test`
Expected: FAIL — `requireRole` not yet implemented; `Cannot find module '../require-role'`.

- [ ] **Step 6: Implement `bia-admin/lib/auth/require-role.ts`**

> Self-read uses the cookie-bound authenticated client (subject to `self read` RLS policy on admin_users). Service-role is reserved for cross-user reads (e.g., listing all admins on the members page). This way, if a future bug accidentally extends `requireRole()` to read another table, RLS catches it instead of silently bypassing.

```ts
import { NextResponse } from "next/server";
import {
  createBiaBrowserClient,
  roleAtLeast,
  type AdminUser,
  type Role,
} from "@bia/shared";
import { createBiaServerClient } from "@bia/shared/next/supabase/server";

export class RoleError extends Error {
  constructor(
    public status: 401 | 403,
    public code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export interface RequireRoleResult {
  user: { id: string; email: string };
  role: Role;
  adminUser: AdminUser;
}

export async function requireRole(min: Role): Promise<RequireRoleResult> {
  const supa = await createBiaServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) throw new RoleError(401, "no_session");

  // Self-read uses authenticated cookie-bound client; RLS self-read policy permits.
  const { data, error } = await supa
    .from("admin_users")
    .select("id, email, role, created_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new RoleError(403, "lookup_failed");
  if (!data) throw new RoleError(403, "not_admin");

  const adminUser = data as AdminUser;
  if (!roleAtLeast(adminUser.role, min)) {
    throw new RoleError(403, `role_required: ${min}`);
  }

  return {
    user: { id: user.id, email: user.email ?? adminUser.email },
    role: adminUser.role,
    adminUser,
  };
}

/**
 * Wraps an API route handler with role gating + standard error mapping.
 * Replaces the duplicated try/catch pattern across handlers.
 */
export async function withRole<T>(
  min: Role,
  handler: (ctx: RequireRoleResult) => Promise<NextResponse<T>>,
): Promise<NextResponse<T> | NextResponse<{ error: string }>> {
  try {
    const ctx = await requireRole(min);
    return await handler(ctx);
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
```

- [ ] **Step 7: Run the tests — expect PASS**

Run: `pnpm --filter bia-admin test`
Expected: all 7 tests PASS (3 from `roleAtLeast` + 4 from `requireRole`).

- [ ] **Step 8: Commit**

```bash
git add bia-admin/lib/auth/ bia-admin/vitest.config.ts
git commit -m "feat(admin): requireRole() helper + tests"
```

---

### Task 10: Middleware

**Files:**
- Create: `bia-admin/middleware.ts`

- [ ] **Step 1: Write the middleware**

```ts
import { updateBiaSession } from "@bia/shared/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateBiaSession(request);
}

export const config = {
  matcher: [
    // Skip Next internals + static + auth callback (to avoid infinite redirect)
    "/((?!_next/static|_next/image|favicon.ico|login|auth/).*)",
  ],
};
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter bia-admin build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add bia-admin/middleware.ts
git commit -m "feat(admin): @supabase/ssr middleware for session refresh"
```

---

### Task 11: Login page (Google + magic link)

**Files:**
- Create: `bia-admin/components/auth/SignInForm.tsx`
- Create: `bia-admin/app/login/page.tsx`

- [ ] **Step 1: Create the SignInForm client component**

`bia-admin/components/auth/SignInForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBiaBrowserClient } from "@bia/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function SignInForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const denied = searchParams.get("denied");
  const returnTo = searchParams.get("return_to") ?? "/admin";

  async function signInWithGoogle() {
    const supa = createBiaBrowserClient();
    const origin = window.location.origin;
    setSubmitting(true);
    const { error } = await supa.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
      },
    });
    if (error) {
      toast.error(error.message);
      setSubmitting(false);
    }
    // On success the browser is redirected to Google.
  }

  async function signInWithMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const supa = createBiaBrowserClient();
    const origin = window.location.origin;
    setSubmitting(true);
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
        shouldCreateUser: true,
      },
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Check your inbox for the magic link.");
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BIA Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sign in to access the admin dashboard.
        </p>
      </div>

      {denied === "not-invited" && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          That email is not on the admin invite list. Ask Bobby to invite you.
        </div>
      )}

      <Button
        onClick={signInWithGoogle}
        disabled={submitting}
        className="w-full"
        variant="outline"
      >
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <hr className="flex-1" />
        <span>or</span>
        <hr className="flex-1" />
      </div>

      <form onSubmit={signInWithMagicLink} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <Button type="submit" disabled={submitting || !email} className="w-full">
          Send magic link
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Create `bia-admin/app/login/page.tsx`**

```tsx
import { Suspense } from "react";
import SignInForm from "@/components/auth/SignInForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter bia-admin build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add bia-admin/app/login/ bia-admin/components/auth/
git commit -m "feat(admin): login page with Google OAuth + magic link"
```

---

### Task 11.5: Migration — `accept_invitation` RPC (Issue 3A)

**Files:**
- Create: `supabase/migrations/20260508000003_accept_invitation_rpc.sql`

> **Why (Issue 3A):** The callback's two-statement "insert admin_users + mark invitation accepted" pattern can leave the system inconsistent if the second statement fails (admin row exists, invitation stays pending). An RPC wraps both writes in one transaction. Atomic.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260508000003_accept_invitation_rpc.sql
--
-- accept_invitation: atomic invite acceptance.
-- Inserts an admin_users row and marks the matching invitation accepted
-- in one transaction. Returns the inserted admin_users row.
--
-- Idempotent on the admin_users insert via on conflict do nothing — if the
-- caller retries (browser refresh on partial failure), the second call is
-- a no-op rather than an error.

create or replace function public.accept_invitation(
  p_invitation_id uuid,
  p_user_id uuid,
  p_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_admin record;
begin
  -- Lock the invitation row and read its role.
  select role into v_role
    from public.admin_invitations
    where id = p_invitation_id and accepted_at is null
    for update;

  if v_role is null then
    raise exception 'invitation_not_found_or_already_accepted'
      using errcode = 'P0001';
  end if;

  -- Insert the admin_users row (or no-op on duplicate).
  insert into public.admin_users (id, email, role)
    values (p_user_id, p_email, v_role)
    on conflict (id) do nothing;

  select id, email, role, created_at into v_admin
    from public.admin_users
    where id = p_user_id;

  -- Mark invitation accepted.
  update public.admin_invitations
    set accepted_at = now()
    where id = p_invitation_id;

  return jsonb_build_object(
    'id', v_admin.id,
    'email', v_admin.email,
    'role', v_admin.role,
    'created_at', v_admin.created_at
  );
end;
$$;

revoke all on function public.accept_invitation(uuid, uuid, text) from public;
grant execute on function public.accept_invitation(uuid, uuid, text) to service_role;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `accept_invitation_rpc` and the SQL above.

- [ ] **Step 3: Verify**

Run via `mcp__supabase__execute_sql`:
```sql
select proname from pg_proc where proname = 'accept_invitation';
```
Expected: 1 row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260508000003_accept_invitation_rpc.sql
git commit -m "feat(db): accept_invitation RPC for atomic invite acceptance"
```

---

### Task 12a: TDD test for auth callback (FIRST)

**Files:**
- Create: `bia-admin/app/auth/callback/__tests__/route.test.ts`

> Eng review T1A. Cases: no code → /login?denied=auth_error, exchangeCodeForSession fails → denied, no user/email → denied, existing admin → /admin, pending invite found → calls `accept_invitation` RPC → /admin, no invite + no admin → signOut + denied.

- [ ] **Step 1: Write the failing test file with all 6 cases**

Mock `@bia/shared/next/supabase/server` and `@bia/shared` (service-role). Each test asserts the redirect URL and (where relevant) that the RPC was called with correct params.

- [ ] **Step 2: Run → expect FAIL**

`pnpm --filter bia-admin test`

- [ ] **Step 3: Commit failing tests**

```bash
git add bia-admin/app/auth/callback/__tests__/
git commit -m "test(admin): auth callback test cases (failing)"
```

---

### Task 12: Auth callback (resolves invites via RPC)

**Files:**
- Create: `bia-admin/app/auth/callback/route.ts`

> **Eng review fix baked in (Issue 3A):** invite acceptance goes through the `accept_invitation` RPC defined in Task 11.5 — atomic insert + invitation update in one transaction.

- [ ] **Step 1: Write the callback route**

```ts
import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@bia/shared";
import { createBiaServerClient } from "@bia/shared/next/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?denied=auth_error`);
  }

  const supa = await createBiaServerClient();
  const { error: exchangeErr } = await supa.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return NextResponse.redirect(`${origin}/login?denied=auth_error`);
  }

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.redirect(`${origin}/login?denied=auth_error`);
  }

  const admin = createBiaServiceRoleClient();

  // Already an admin? Just go.
  const { data: existing } = await admin
    .from("admin_users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Look for a pending invitation by email (case-insensitive).
  const { data: invitation } = await admin
    .from("admin_invitations")
    .select("id, role")
    .ilike("email", user.email)
    .is("accepted_at", null)
    .maybeSingle();

  if (!invitation) {
    // No row in admin_users AND no pending invite → deny.
    await supa.auth.signOut();
    return NextResponse.redirect(`${origin}/login?denied=not-invited`);
  }

  // Atomic accept: RPC inserts admin_users + marks invitation accepted in one tx.
  const { error: rpcErr } = await admin.rpc("accept_invitation", {
    p_invitation_id: invitation.id,
    p_user_id: user.id,
    p_email: user.email,
  });
  if (rpcErr) {
    await supa.auth.signOut();
    return NextResponse.redirect(`${origin}/login?denied=invite_failed`);
  }

  // Audit (best-effort; failure here doesn't roll back the accept).
  await admin.from("admin_audit_log").insert({
    admin_email: user.email,
    action: "accept_invitation",
    entity_type: "admin_user",
    entity_id: user.id,
    payload: { invitation_id: invitation.id, role: invitation.role },
  });

  return NextResponse.redirect(`${origin}${next}`);
}
```

- [ ] **Step 2: Run tests → expect PASS**

`pnpm --filter bia-admin test`

- [ ] **Step 3: Commit**

```bash
git add bia-admin/app/auth/
git commit -m "feat(admin): auth callback — resolves invites via accept_invitation RPC"
```

---

### Task 13: Admin shell (sidebar + topbar)

**Files:**
- Create: `bia-admin/lib/admin/sections.ts`
- Create: `bia-admin/components/SidebarNav.tsx`
- Create: `bia-admin/components/AdminShell.tsx`
- Create: `bia-admin/app/(admin)/layout.tsx`
- Create: `bia-admin/app/(admin)/page.tsx` (replaces stub from Task 7)

- [ ] **Step 1: Create `bia-admin/lib/admin/sections.ts`**

```ts
import {
  Calendar,
  Newspaper,
  Package,
  Star,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";

export type AdminGroup = "content" | "community" | "operations" | "people";

export interface AdminSection {
  href: string;
  label: string;
  icon: LucideIcon;
  group: AdminGroup;
  /** Disabled sections render greyed out with a tooltip "Coming in Phase X". */
  enabled: boolean;
  comingIn?: string;
}

export const ADMIN_GROUPS: Record<AdminGroup, string> = {
  content: "Content",
  community: "Community",
  operations: "Operations",
  people: "People",
};

export const ADMIN_SECTIONS: AdminSection[] = [
  // Phase 1 — enabled
  { href: "/admin/members", label: "Members", icon: Users, group: "people", enabled: true },

  // Phase 2 — disabled placeholders
  { href: "/admin/blog",     label: "Blog",     icon: Newspaper, group: "content",   enabled: false, comingIn: "Phase 2" },
  { href: "/admin/events",   label: "Events",   icon: Calendar,  group: "content",   enabled: false, comingIn: "Phase 2" },
  { href: "/admin/sponsors", label: "Sponsors", icon: Star,      group: "content",   enabled: false, comingIn: "Phase 2" },
  { href: "/admin/squad",    label: "Squad",    icon: Users2,    group: "community", enabled: false, comingIn: "Phase 2" },

  // Phase 3 — disabled placeholder
  { href: "/admin/shipping/parcels", label: "集运", icon: Package, group: "operations", enabled: false, comingIn: "Phase 3" },
];
```

- [ ] **Step 2: Create `bia-admin/components/SidebarNav.tsx` (client subcomponent)**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ADMIN_SECTIONS,
  ADMIN_GROUPS,
  type AdminSection,
  type AdminGroup,
} from "@/lib/admin/sections";

export default function SidebarNav() {
  const pathname = usePathname();
  const grouped: Record<AdminGroup, AdminSection[]> = {
    content: [],
    community: [],
    operations: [],
    people: [],
  };
  for (const s of ADMIN_SECTIONS) grouped[s.group].push(s);

  return (
    <nav className="flex-1 space-y-6">
      {(Object.keys(grouped) as AdminGroup[]).map((g) => {
        if (grouped[g].length === 0) return null;
        return (
          <div key={g}>
            <p className="px-2 mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase text-zinc-500">
              {ADMIN_GROUPS[g]}
            </p>
            <ul className="space-y-px">
              {grouped[g].map((s) => {
                const active =
                  pathname === s.href || pathname.startsWith(s.href + "/");
                const Icon = s.icon;
                if (!s.enabled) {
                  return (
                    <li key={s.href}>
                      <span
                        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-zinc-600 cursor-not-allowed"
                        title={`Coming in ${s.comingIn}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{s.label}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-600">
                          soon
                        </span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors",
                        active
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{s.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Create `bia-admin/components/AdminShell.tsx`**

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, RoleError } from "@/lib/auth/require-role";
import SidebarNav from "@/components/SidebarNav";

export default async function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole("viewer");
  } catch (err) {
    if (err instanceof RoleError && err.status === 401) {
      redirect("/login");
    }
    if (err instanceof RoleError && err.status === 403) {
      redirect("/login?denied=not-invited");
    }
    throw err;
  }

  return (
    <div className="min-h-screen flex bg-zinc-50 text-foreground">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-zinc-900 text-zinc-100 flex flex-col p-4">
        <Link
          href="/admin"
          className="text-lg font-bold tracking-tight mb-6 px-2"
        >
          BIA Admin
        </Link>
        <SidebarNav />
        <div className="mt-auto pt-4 border-t border-zinc-800 px-2 text-xs">
          <p className="text-zinc-400 truncate">{ctx.user.email}</p>
          <p className="text-zinc-500 capitalize">{ctx.role.replace("_", " ")}</p>
          <form action="/auth/signout" method="POST" className="mt-2">
            <button
              type="submit"
              className="text-zinc-400 hover:text-white text-xs underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Create `bia-admin/app/auth/signout/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createBiaServerClient } from "@bia/shared";

export async function POST(request: Request) {
  const supa = await createBiaServerClient();
  await supa.auth.signOut();
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/login`, 303);
}
```

- [ ] **Step 5: Create `bia-admin/app/(admin)/layout.tsx`**

```tsx
import AdminShell from "@/components/AdminShell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
```

- [ ] **Step 6: Replace `bia-admin/app/(admin)/page.tsx`**

Delete the placeholder root-level `app/page.tsx` redirect from Task 7 step 9 — keep it. The `(admin)` route group's own `page.tsx` is `/admin`:

`bia-admin/app/(admin)/page.tsx`:

```tsx
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";

export default async function AdminHomePage() {
  const { user } = await requireRole("viewer");

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user.email.split("@")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Phase 1 dashboard — full "what needs you today" cards land in Phase 2.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
        <Link href="/admin/members" className="group">
          <Card className="transition-colors group-hover:border-primary">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Members</CardTitle>
              </div>
              <CardDescription>
                Invite officers, change roles, revoke access.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Manage who can sign into the dashboard.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify build**

Run: `pnpm --filter bia-admin build`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add bia-admin/app/ bia-admin/components/ bia-admin/lib/admin/
git commit -m "feat(admin): admin shell with sidebar + dashboard placeholder"
```

---

### Task 14: Audit log helper

**Files:**
- Create: `bia-admin/lib/admin/audit-log.ts`

- [ ] **Step 1: Write the helper**

```ts
import { createBiaServiceRoleClient } from "@bia/shared";

export interface AuditEntry {
  admin_email: string;
  action: string;
  entity_type: "admin_user" | "admin_invitation";
  entity_id?: string | null;
  payload?: Record<string, unknown>;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const admin = createBiaServiceRoleClient();
  const { error } = await admin.from("admin_audit_log").insert({
    admin_email: entry.admin_email,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    payload: entry.payload ?? {},
  });
  if (error) {
    console.error("audit log insert failed:", error);
    // Do not throw — audit failure should not break user-facing actions.
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add bia-admin/lib/admin/audit-log.ts
git commit -m "feat(admin): audit log helper"
```

---

### Task 15a: TDD test for invite endpoint (FIRST)

**Files:**
- Create: `bia-admin/app/api/admin/members/invite/__tests__/route.test.ts`

> Eng review T1A: write the test BEFORE the implementation. Mock `@bia/shared`, `@bia/shared/next/supabase/server`, and `@/lib/admin/audit-log` the same way Task 9 did. Cases: 403 when not super_admin, 400 invalid body, 409 already_admin, 409 already_invited (unique-index error code 23505), 500 with rollback on email send fail, 200 on success (calls `auth.admin.inviteUserByEmail` per Issue 2A).

- [ ] **Step 1: Write the failing test file with all 6 cases**

Mock setup mirrors Task 9 step 4. Each test asserts: status code, response JSON shape, and (where relevant) that `admin_invitations.delete()` was called for the rollback case.

- [ ] **Step 2: Run test → expect FAIL (file under test doesn't exist yet)**

`pnpm --filter bia-admin test`

- [ ] **Step 3: Commit the failing test**

```bash
git add bia-admin/app/api/admin/members/invite/__tests__/
git commit -m "test(admin): invite endpoint test cases (failing)"
```

---

### Task 15: Members API — invite (uses inviteUserByEmail + withRole)

**Files:**
- Create: `bia-admin/app/api/admin/members/invite/route.ts`

> **Eng review fixes baked in:**
> - **Issue 2A**: send invite via `supabase.auth.admin.inviteUserByEmail()` (templated invite email), not `signInWithOtp` (generic magic link).
> - **Issue 11A**: use the `withRole()` wrapper instead of inline try/catch.

- [ ] **Step 1: Write the invite endpoint**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@bia/shared";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const InviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(["super_admin", "editor", "viewer"]),
});

export async function POST(request: Request) {
  return withRole("super_admin", async (ctx) => {
    const json = await request.json().catch(() => null);
    const parsed = InviteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const { email, role } = parsed.data;
    const admin = createBiaServiceRoleClient();

    // Reject if already an admin.
    const { data: existing } = await admin
      .from("admin_users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "already_admin" }, { status: 409 });
    }

    // Insert invitation. Unique partial index prevents duplicate pending invites.
    const { data: invitation, error: insertErr } = await admin
      .from("admin_invitations")
      .insert({ email, role, invited_by: ctx.user.id })
      .select()
      .single();
    if (insertErr) {
      if (insertErr.code === "23505") {
        return NextResponse.json({ error: "already_invited" }, { status: 409 });
      }
      return NextResponse.json(
        { error: "insert_failed", details: insertErr.message },
        { status: 500 },
      );
    }

    // Send the invite email via Supabase's templated invite API.
    // Template configurable in Supabase dashboard → Authentication → Email Templates → Invite.
    const origin = new URL(request.url).origin;
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/admin`,
      data: { invited_role: role, invited_by: ctx.user.email },
    });
    if (inviteErr) {
      // Roll back the invitation to avoid orphans.
      await admin.from("admin_invitations").delete().eq("id", invitation.id);
      return NextResponse.json(
        { error: "email_send_failed", details: inviteErr.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: ctx.user.email,
      action: "invite_sent",
      entity_type: "admin_invitation",
      entity_id: invitation.id,
      payload: { email, role },
    });

    return NextResponse.json({ ok: true, invitation });
  });
}
```

- [ ] **Step 2: Run tests → expect PASS**

`pnpm --filter bia-admin test`

- [ ] **Step 3: Commit**

```bash
git add bia-admin/app/api/admin/members/invite/route.ts
git commit -m "feat(admin): POST /api/admin/members/invite"
```

---

### Task 16a: TDD test for [id] route (FIRST)

**Files:**
- Create: `bia-admin/app/api/admin/members/[id]/__tests__/route.test.ts`

> Eng review T1A. Cases for PATCH: 403 not super_admin, 400 invalid body, 400 cannot_change_own_role, 200 success + audit log called. Cases for DELETE: 403 not super_admin, 400 cannot_delete_self, 200 success + audit log called.

- [ ] **Step 1: Write the failing test file with all 6 cases**

Mock setup mirrors Task 9 step 4. Each test asserts: status code, response JSON, and `writeAudit` call assertions.

- [ ] **Step 2: Run test → expect FAIL**

`pnpm --filter bia-admin test`

- [ ] **Step 3: Commit the failing tests**

```bash
git add bia-admin/app/api/admin/members/\[id\]/__tests__/
git commit -m "test(admin): [id] PATCH/DELETE test cases (failing)"
```

---

### Task 16: Members API — change role + delete admin (uses withRole)

**Files:**
- Create: `bia-admin/app/api/admin/members/[id]/route.ts`

> **Eng review fix baked in (Issue 11A):** uses the `withRole()` wrapper instead of inline try/catch.

- [ ] **Step 1: Write the route handler**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@bia/shared";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const PatchSchema = z.object({
  role: z.enum(["super_admin", "editor", "viewer"]),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    if (id === auth.user.id) {
      return NextResponse.json(
        { error: "cannot_change_own_role" },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const { error } = await admin
      .from("admin_users")
      .update({ role: parsed.data.role })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "role_changed",
      entity_type: "admin_user",
      entity_id: id,
      payload: { role: parsed.data.role },
    });

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    if (id === auth.user.id) {
      return NextResponse.json(
        { error: "cannot_delete_self" },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const { error } = await admin.from("admin_users").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "admin_removed",
      entity_type: "admin_user",
      entity_id: id,
    });

    return NextResponse.json({ ok: true });
  });
}
```

- [ ] **Step 2: Run tests → expect PASS**

`pnpm --filter bia-admin test`

- [ ] **Step 3: Commit**

```bash
git add bia-admin/app/api/admin/members/\[id\]/route.ts
git commit -m "feat(admin): PATCH/DELETE /api/admin/members/[id]"
```

---

### Task 17a: TDD test for invitations [id] route (FIRST)

**Files:**
- Create: `bia-admin/app/api/admin/members/invitations/[id]/__tests__/route.test.ts`

> Eng review T1A. Cases: 403 not super_admin, 200 success + audit log called with prior email.

- [ ] **Step 1: Write failing test file with both cases**

`pnpm --filter bia-admin test`

- [ ] **Step 2: Commit failing tests**

```bash
git add bia-admin/app/api/admin/members/invitations/\[id\]/__tests__/
git commit -m "test(admin): invitations [id] DELETE test cases (failing)"
```

---

### Task 17: Members API — revoke pending invitation (uses withRole)

**Files:**
- Create: `bia-admin/app/api/admin/members/invitations/[id]/route.ts`

> **Eng review fix baked in (Issue 11A):** uses the `withRole()` wrapper.

- [ ] **Step 1: Write the route handler**

```ts
import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@bia/shared";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const { data: invitation } = await admin
      .from("admin_invitations")
      .select("email")
      .eq("id", id)
      .maybeSingle();

    const { error } = await admin
      .from("admin_invitations")
      .delete()
      .eq("id", id)
      .is("accepted_at", null);
    if (error) {
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "invitation_revoked",
      entity_type: "admin_invitation",
      entity_id: id,
      payload: { email: invitation?.email ?? null },
    });

    return NextResponse.json({ ok: true });
  });
}
```

- [ ] **Step 2: Run tests → expect PASS**

`pnpm --filter bia-admin test`

- [ ] **Step 3: Commit**

```bash
git add bia-admin/app/api/admin/members/invitations/\[id\]/route.ts
git commit -m "feat(admin): DELETE /api/admin/members/invitations/[id]"
```

---

### Task 18: Members page — server component (read-only list)

**Files:**
- Create: `bia-admin/app/(admin)/members/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { createBiaServiceRoleClient } from "@bia/shared";
import { requireRole } from "@/lib/auth/require-role";
import MembersClient from "./MembersClient";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const ctx = await requireRole("viewer");

  const admin = createBiaServiceRoleClient();

  const [{ data: admins }, { data: invitations }] = await Promise.all([
    admin
      .from("admin_users")
      .select("id, email, role, created_at")
      .order("created_at", { ascending: true }),
    admin
      .from("admin_invitations")
      .select("id, email, role, created_at, invited_by, accepted_at")
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Officers who can sign in to BIA Admin.
        </p>
      </header>

      <MembersClient
        currentUserId={ctx.user.id}
        currentRole={ctx.role}
        admins={admins ?? []}
        invitations={invitations ?? []}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add bia-admin/app/\(admin\)/members/page.tsx
git commit -m "feat(admin): /admin/members server page"
```

---

### Task 19: Members page — client component (invite + actions)

**Files:**
- Create: `bia-admin/app/(admin)/members/MembersClient.tsx`

> **Eng review fix (small):** the code below uses `window.confirm()` for the remove-admin flow. Replace it with shadcn's `AlertDialog` (already added in Task 8) for visual consistency and to avoid the modal-dialog pitfall flagged for browser automation tooling. Wrap the trigger in an `<AlertDialog>`/`<AlertDialogTrigger>`/`<AlertDialogContent>` with the destructive action button calling `removeAdmin(id)` directly. Keep the 4-line logic of `removeAdmin()` itself unchanged.

- [ ] **Step 1: Write the client component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus } from "lucide-react";
import type { Role, AdminUser, AdminInvitation } from "@bia/shared";

interface Props {
  currentUserId: string;
  currentRole: Role;
  admins: AdminUser[];
  invitations: AdminInvitation[];
}

export default function MembersClient({
  currentUserId,
  currentRole,
  admins,
  invitations,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");

  const canManage = currentRole === "super_admin";

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/members/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "invite_failed");
      return;
    }
    toast.success(`Invited ${email}`);
    setInviteOpen(false);
    setEmail("");
    setRole("editor");
    startTransition(() => router.refresh());
  }

  async function changeRole(id: string, nextRole: Role) {
    const res = await fetch(`/api/admin/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "update_failed");
      return;
    }
    toast.success("Role updated");
    startTransition(() => router.refresh());
  }

  async function removeAdmin(id: string) {
    if (!confirm("Remove this admin? They'll lose dashboard access.")) return;
    const res = await fetch(`/api/admin/members/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "delete_failed");
      return;
    }
    toast.success("Admin removed");
    startTransition(() => router.refresh());
  }

  async function revokeInvitation(id: string) {
    const res = await fetch(`/api/admin/members/invitations/${id}`, {
      method: "DELETE",
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "delete_failed");
      return;
    }
    toast.success("Invitation revoked");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-8">
      {canManage && (
        <div className="flex justify-end">
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                Invite admin
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submitInvite} className="space-y-4">
                <DialogHeader>
                  <DialogTitle>Invite a new admin</DialogTitle>
                  <DialogDescription>
                    They'll receive a magic link by email. Click → sign in →
                    `admin_users` row created with the role you pick.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="officer@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="super_admin">Super admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={pending || !email}>
                    Send invite
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Active admins ({admins.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {canManage && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.email}</TableCell>
                  <TableCell className="capitalize">
                    {a.role.replace("_", " ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString()}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => changeRole(a.id, "viewer")}
                            disabled={a.id === currentUserId || a.role === "viewer"}
                          >
                            Set to viewer
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => changeRole(a.id, "editor")}
                            disabled={a.id === currentUserId || a.role === "editor"}
                          >
                            Set to editor
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => changeRole(a.id, "super_admin")}
                            disabled={
                              a.id === currentUserId || a.role === "super_admin"
                            }
                          >
                            Set to super admin
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => removeAdmin(a.id)}
                            disabled={a.id === currentUserId}
                            className="text-destructive"
                          >
                            Remove admin
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pending invites ({invitations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invitations.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent</TableHead>
                  {canManage && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.email}</TableCell>
                    <TableCell className="capitalize">
                      {i.role.replace("_", " ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(i.created_at).toLocaleDateString()}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revokeInvitation(i.id)}
                          className="text-destructive"
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter bia-admin build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add bia-admin/app/\(admin\)/members/MembersClient.tsx
git commit -m "feat(admin): members client UI — invite dialog + role + revoke"
```

---

### Task 20: Local end-to-end smoke test

**Files:** none (manual test)

- [ ] **Step 1: Set local env**

Create `bia-admin/.env.local` (do NOT commit):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ujkaregrwrppaehvbahf.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
```

Add `bia-admin/.env.local` to gitignore if not already covered.

- [ ] **Step 2: Run dev server**

Run: `cd "/Users/mac/Documents/BIA 新生service" && pnpm --filter bia-admin dev`
Expected: starts on http://localhost:3000.

- [ ] **Step 3: Visit / and verify redirect**

Open http://localhost:3000.
Expected: redirected to `/login`.

- [ ] **Step 4: Sign in with Google as Bobby**

Click "Continue with Google", authenticate as `yangb7777@gmail.com`.
Expected: redirected to `/admin`. See "Welcome back, yangb7777" + Members card.

- [ ] **Step 5: Re-run seed if needed**

If seed in Task 6 returned 0 rows because Bobby hadn't yet authenticated, re-run via MCP:

```sql
insert into public.admin_users (id, email, role)
select id, email, 'super_admin'
from auth.users
where lower(email) = lower('yangb7777@gmail.com')
on conflict (id) do nothing
returning id, email, role;
```

Expected: 1 row returned. Refresh `/admin` — page loads (no longer denied).

- [ ] **Step 6: Test Members page**

Navigate to `/admin/members`.
Expected: see Bobby's row in "Active admins" with role `super admin`.

- [ ] **Step 7: Send invite**

Click "+ Invite admin", enter a test email you control, role=editor, submit.
Expected:
1. Toast "Invited <email>".
2. New row in "Pending invites".
3. Magic-link email arrives at the test address.

- [ ] **Step 8: Accept invite (incognito window)**

Open the magic link in an incognito window. Click through the email, sign in.
Expected: redirected to `/admin`. Original Bobby session: refresh `/admin/members`. Verify:
1. Test email now in "Active admins" with role `editor`.
2. The invitation has disappeared from "Pending invites".

- [ ] **Step 9: Test role gate via curl from editor session**

From the test (editor) session, get its session cookie. Then:

```bash
curl -X PATCH http://localhost:3000/api/admin/members/<bobby-uuid> \
  -H "Content-Type: application/json" \
  -H "Cookie: <session cookies from editor browser>" \
  -d '{"role":"editor"}'
```

Expected: HTTP 403 with `{"error":"role_required: super_admin"}`.

- [ ] **Step 10: Test self-mutation guard**

From Bobby's session, attempt to PATCH his own row's role via dropdown — verify the menu items for his own row are all disabled.

- [ ] **Step 11: Audit log check**

Run via MCP `execute_sql`:
```sql
select admin_email, action, entity_type, entity_id, payload, ts
from public.admin_audit_log
order by ts desc
limit 10;
```

Expected: rows for `accept_invitation`, `invite_sent`, possibly `role_changed`. Each tied to the right admin email.

- [ ] **Step 12: No commit**

This task is verification only. If any step fails, fix the underlying code in earlier tasks and re-test.

---

### Task 21: Vercel deployment

**Files:** none (Vercel config done via dashboard)

- [ ] **Step 1: Configure Google OAuth in Supabase Auth dashboard**

In Supabase dashboard → Authentication → Providers → Google:
- Enable Google
- Client ID + Client Secret from Google Cloud Console
- Add redirect URLs:
  - `http://localhost:3000/auth/callback`
  - `https://bia-admin.vercel.app/auth/callback`
  - (Add `https://admin.uscbia.com/auth/callback` later in Phase 4 when DNS cuts over.)

- [ ] **Step 2: Create Vercel project**

In Vercel dashboard:
- Import from GitHub: `BIBOYANG425/bia-roommate` (the BIA 新生service repo, which despite its name pushes to that GitHub URL — confirmed from `git remote -v`).
- Project name: `bia-admin`.
- Framework preset: Next.js.
- Root directory: `bia-admin`.
- Install command: `pnpm install` (workspace-aware).
- Build command: `pnpm build` (uses workspace script).
- Output directory: `.next` (default).

- [ ] **Step 3: Set Vercel env vars**

In project Settings → Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://ujkaregrwrppaehvbahf.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (from Supabase)
- `SUPABASE_SERVICE_ROLE_KEY` = (from Supabase, **mark as Sensitive**)
- `SUPABASE_JWT_SECRET` = (from Supabase, **mark as Sensitive**)

Apply to: Production + Preview + Development.

- [ ] **Step 4: Trigger deploy**

Push to `main` (or click "Deploy" in Vercel dashboard).
Expected: build succeeds. Site loads at `https://bia-admin.vercel.app`.

- [ ] **Step 5: Production smoke test**

Repeat Task 20 steps 3–11 against `https://bia-admin.vercel.app`. Use a different test invite email so you don't pollute local-test state.

- [ ] **Step 6: Document the deploy in CHANGELOG-style commit**

Add a note to the design doc (or a new `docs/superpowers/CHANGELOG.md`):

```md
## 2026-05-08 — Phase 1 shipped

- bia-admin live at https://bia-admin.vercel.app
- super_admin · editor · viewer roles
- Members invite + role change + revoke working
- DNS cutover to admin.uscbia.com is Phase 4
```

```bash
git add docs/superpowers/CHANGELOG.md
git commit -m "docs: log Phase 1 ship — bia-admin foundation"
```

---

## Verification (end-to-end)

This summarizes the Task 20 + Task 21 manual smoke into a final checklist:

| # | Check | Expected |
|---|---|---|
| 1 | `pnpm install && pnpm -r build` from repo root | exits 0 |
| 2 | `pnpm --filter bia-admin test` | all tests PASS |
| 3 | `mcp__supabase__list_tables` lists `admin_users` and `admin_invitations` | yes |
| 4 | `mcp__supabase__execute_sql "select * from admin_users"` shows Bobby with role `super_admin` (seed may be deferred until first sign-in per Task 6 fallback — re-run seed via Task 20.5 if needed) | yes |
| 5 | Local: visit `http://localhost:3000/` → redirected to `/login` | yes |
| 6 | Local: sign in with Bobby's Google → land on `/admin` | yes |
| 7 | Local: `/admin/members` shows Bobby in Active, +Invite button visible | yes |
| 8 | Local: invite a test email → row appears in Pending + email arrives | yes |
| 9 | Local: accept invite in incognito → row moves to Active | yes |
| 10 | Local: editor session PATCHing Bobby's role → 403 `role_required: super_admin` | yes |
| 11 | Audit log shows `accept_invitation`, `invite_sent`, etc. | yes |
| 12 | Production smoke (steps 5–11 against `bia-admin.vercel.app`) | yes |

If all 12 checks pass, Phase 1 is complete. Move to Phase 2 (Blog + Events + Sponsors + Squad-mod public surfaces) per spec §15 Risk 4.

---

## Out-of-scope reminders

- **Phase 2** (next): Blog HTML drop pipeline, draft→review→publish, public `/blog` reader on uscbia.com, replace landing-page placeholder cards, BIA Events admin + landing hero, Sponsors CRUD, Squad moderation.
- **Phase 3**: Port shipping pages from uscbia.com `/admin/shipping` into bia-admin.
- **Phase 4**: Remove `app/admin/*` from uscbia.com. Point `admin.uscbia.com` DNS at the Vercel project.

Each gets its own plan file: `2026-05-08-bia-admin-phase[2|3|4]-*.md`.

---

## Eng Review Completion Summary (2026-05-08)

- Step 0 Scope Challenge: scope accepted — minor adjustments (TanStack deps deferred to Phase 2)
- Architecture Review: 5 issues found
  - 1A — `@bia/shared` server-only constraint → **applied**: split into framework-agnostic + `@bia/shared/next/*` subpaths
  - 2A — invite email UX → **applied**: switched to `auth.admin.inviteUserByEmail()`
  - 3A — atomic invite acceptance → **applied**: added `accept_invitation` RPC migration (Task 11.5)
  - 5A — repo entanglement → **applied**: new GitHub repo `BIBOYANG425/bia-admin` (Task 0)
  - 7 — seed timing doc inconsistency → **applied**: verification step 4 footnote
- Code Quality Review: 3 issues found
  - 8A — service-role discipline → **applied**: requireRole() now uses cookie-bound client
  - 11A — DRY API route try/catch → **applied**: `withRole()` helper; all 4 handlers refactored
  - 9 — `confirm()` for delete → **applied**: shadcn AlertDialog directive in Task 19
- Test Review: diagram produced, 28 gaps identified across 6 codepaths
  - T1A — full TDD coverage for callback + 3 API routes → **applied**: Tasks 12a, 15a, 16a, 17a, plus extended require-role tests for `lookup_failed` and `withRole`
- Performance Review: no issues
- NOT in scope: written
- What already exists: written
- TODOS.md updates: TODOS.md "Admin Dashboard for BIA Team" P1 cross-references this plan as the realization
- Failure modes: 1 critical-ish gap flagged (members page service-role read on Supabase outage shows generic 500 — accepted, defer to Phase 2 polish)
- Outside voice: skipped (low net value for internal tooling)
- Parallelization: 5 lanes possible, sequential recommended (Phase 1 too small)
- Lake Score: 7/8 recommendations chose the complete option (skipped only the outside-voice optional)

Total: 13 issues raised, 13 applied to the plan. Plan grew from 21 to 27 tasks (added Task 0, 11.5, 12a, 15a, 16a, 17a).

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 13 issues, 0 critical gaps, all applied |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0
**VERDICT:** ENG CLEARED — ready to implement
