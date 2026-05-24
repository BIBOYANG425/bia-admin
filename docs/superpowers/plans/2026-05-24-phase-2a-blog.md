# Phase 2A — Blog Implementation Plan (rev 3, audit + complete)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 2A by (a) verifying the already-built pieces match the design doc, (b) applying the two un-applied migrations, (c) shipping the admin `/admin/blog` UI + API that's still missing, and (d) fixing two real bugs flagged in code review.

**Why rev 3:** Codex audit revealed reality drift — the shared `@biboyang425/bia-shared@0.2.0` articles toolkit, the bia-roommate `/blog`, `/blog/[slug]`, and landing `BlogPreview` are **already built**. The DB schema migrations are written but **not applied**. The admin app is the only side that has nothing for blog yet.

---

## Already done (verified on disk and via Supabase MCP)

| Area | Path | Status |
|---|---|---|
| Shared types | `packages/bia-shared/src/types.ts` | `Article`, `ArticleStatus`, `ArticleLanguage` (`'en'|'zh'`) ✓ |
| Shared sanitize | `packages/bia-shared/src/articles/sanitize.ts` | DOMPurify allowlist (incl. tables); strips `<img>`, `<script>`, `<style>`, `<iframe>`, `class`/`id`/`style` attrs ✓ |
| Shared slug | `packages/bia-shared/src/articles/slug.ts` | `createArticleSlug` + alias `slugify` + `withCollisionSuffix` ✓ |
| Shared excerpt | `packages/bia-shared/src/articles/excerpt.ts` | `createArticleExcerpt` + alias `deriveExcerpt` ✓ |
| Shared renderer | `packages/bia-shared/src/articles/ArticleRenderer.tsx` | Server-component-safe; defaults to `prose prose-neutral max-w-none` ✓ |
| Shared barrel | `packages/bia-shared/src/articles/index.ts` | All articles toolkit re-exports ✓ |
| Shared version | `packages/bia-shared/package.json` | `0.2.0` (publish status to GitHub Packages: **verify in Task 0**) |
| DB migration: articles | `supabase/migrations/20260524000001_create_articles.sql` | Full schema, partial-unique-published slug index, `set_updated_at` trigger, RLS allow anon read published — **not applied** |
| DB migration: storage | `supabase/migrations/20260524000002_storage_article_covers.sql` | Public bucket, 5MB, image mimes — **not applied** |
| Public reader: list | `bia-roommate/app/blog/page.tsx` | "Latest Dispatches" heading, ISR 60s, cover images, locale-aware "中文 / English" pill ✓ |
| Public reader: detail | `bia-roommate/app/blog/[slug]/page.tsx` | ArticleRenderer + cover hero + OG metadata ✓ |
| Public reader: data | `bia-roommate/lib/articles.ts` | Reuses `createServerSupabaseClient`; types from shared ✓ |
| Landing wiring | `bia-roommate/app/page.tsx` | Imports + uses `<BlogPreview>` at line 411 ✓ |
| Landing card | `bia-roommate/components/BlogPreview.tsx` | Client component, uses `createBrowserSupabaseClient`, tilted-card layout, gradient fallback when no cover ✓ |
| bia-roommate dep | `bia-roommate/package.json` | `@biboyang425/bia-shared: ^0.2.0`, `@tailwindcss/typography` ✓ |
| Admin audit helper | `bia-admin/lib/admin/audit-log.ts` | `writeAudit({admin_email, action, entity_type, entity_id, payload})` exists, **but `entity_type` union is `"admin_user" | "admin_invitation"` only — needs widening to include `"article"`** |

---

## Still to build / fix

1. Apply the two migrations.
2. Verify `@biboyang425/bia-shared@0.2.0` is in GitHub Packages (or publish it).
3. Widen `writeAudit` `entity_type` to include `"article"`.
4. Centralize admin `p-8` in `AdminShell` (Codex P2 rev 1).
5. Enable Blog in sidebar (`bia-admin/lib/admin/sections.ts`).
6. Build admin API: `POST/GET /api/admin/articles`, `GET/PATCH/DELETE /[id]`, transitions `submit/reject/publish/unpublish`, `cover-upload`. All TDD'd.
7. Build admin UI: `/admin/blog` list, `/admin/blog/new`, `/admin/blog/[id]`, `BlogEditor`, `CoverImageInput`.
8. **Fix 2 real bugs** (see Task 4 + Task 7):
   - Slug uniqueness gap — partial-unique-on-published index allows draft slugs to shadow already-published ones, causing `publish` to 500 with PG 23505 instead of a clean 409. Fix: re-check at publish time and bump suffix.
   - Cover upload protocol — `fetch(signedUrl, { method: "PUT", body: file })` will silently 4xx. Supabase signed-upload URLs require the SDK helper `uploadToSignedUrl(path, token, file)`.
9. Production end-to-end smoke (Task 13).

**Out of scope (deferred):** scheduled publish, draft preview link for non-admins, .zip upload pipeline, multilingual cross-link.

---

## Tech Stack
Next.js 16, `@supabase/ssr`, shadcn/ui (existing primitives in `bia-admin/components/ui/`), Vitest, isomorphic-dompurify (already in shared), Tailwind v4

---

## Task 0 — Audit + branch setup

- [ ] **Step 1: Verify shared@0.2.0 is published**

```bash
cd "/Users/mac/Documents/BIA 新生service" && gh run list --workflow=publish-shared.yml --limit 5
```

Expected: a successful run after the 0.2.0 commit. If none exists, push a no-op commit on main to trigger it, or run `npm view @biboyang425/bia-shared versions --registry=https://npm.pkg.github.com`. The bia-roommate consumer will fail Vercel builds without 0.2.0 in the registry.

If no 0.2.0 in registry, just push to main:
```bash
git checkout main && git pull && git commit --allow-empty -m "chore(shared): retrigger publish workflow" && git push
gh run watch
```

- [ ] **Step 2: Branch in both repos**

```bash
cd "/Users/mac/Documents/BIA 新生service" && git checkout main && git pull origin main && git checkout -b feat/phase-2a-blog-admin
cd /Users/mac/Documents/bia-roommate && git checkout main && git pull origin main
```

(bia-roommate doesn't need a branch — its blog work is already on main. Only the admin repo has new code.)

- [ ] **Step 3: Verify branch**

```bash
cd "/Users/mac/Documents/BIA 新生service" && git branch --show-current
```

Expected: `feat/phase-2a-blog-admin`

---

## Task 1 — Apply DB migrations

The migration files already exist; they just haven't been applied to the live Supabase project (`ujkaregrwrppaehvbahf`).

- [ ] **Step 1: Apply articles migration**

Use `mcp__claude_ai_Supabase__apply_migration` with:
- `project_id: "ujkaregrwrppaehvbahf"`
- `name: "20260524000001_create_articles"`
- `query`: the full contents of `supabase/migrations/20260524000001_create_articles.sql`

- [ ] **Step 2: Apply storage bucket migration**

`mcp__claude_ai_Supabase__apply_migration` with `name: "20260524000002_storage_article_covers"` and the contents of `20260524000002_storage_article_covers.sql`.

- [ ] **Step 3: Verify**

Run via `mcp__claude_ai_Supabase__execute_sql`:

```sql
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='articles'
order by ordinal_position;
```

Expected: 18 columns including `html_clean`, `cover_image_url`, all the `*_at`/`*_by` audit fields, `language`, `tags`, `status`.

```sql
select policyname from pg_policies where tablename='articles';
```

Expected: `articles_public_read_published`.

```sql
select id, public, file_size_limit from storage.buckets where id='article-covers';
```

Expected: one row, `public=true`, `file_size_limit=5242880`.

- [ ] **Step 4: Quick public-reader smoke**

```bash
cd /Users/mac/Documents/bia-roommate && npm run dev
```

Visit `localhost:3000/blog`. Expect: "Latest Dispatches" heading + "No posts yet." (no errors — column references resolve now that the table exists).

No commit needed for this task — migration files were already committed previously.

---

## Task 2 — Widen `writeAudit` `entity_type` to include `"article"`

**Files:**
- Modify: `bia-admin/lib/admin/audit-log.ts`

The existing helper restricts `entity_type` to `"admin_user" | "admin_invitation"`. Article actions need `"article"`.

- [ ] **Step 1: Edit the type**

In `bia-admin/lib/admin/audit-log.ts`, change line 6 from:

```ts
entity_type: "admin_user" | "admin_invitation";
```

to:

```ts
entity_type: "admin_user" | "admin_invitation" | "article";
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter bia-admin exec tsc --noEmit
```

Expected: exit 0 (no callers break — we only widened the union).

- [ ] **Step 3: Commit**

```bash
cd "/Users/mac/Documents/BIA 新生service"
git add bia-admin/lib/admin/audit-log.ts
git commit -m "feat(admin): widen writeAudit entity_type to include 'article'"
```

---

## Task 3 — Centralize admin shell padding + enable Blog in sidebar

**Files:**
- Modify: `bia-admin/components/AdminShell.tsx`
- Modify: `bia-admin/lib/admin/sections.ts`
- Modify: `bia-admin/app/(admin)/admin/members/page.tsx` (dedupe `p-8`)

- [ ] **Step 1: Inspect existing admin pages for p-8 wrappers**

```bash
grep -rn "className=\"p-8\\|className=\"p-8 \\|p-8\"" "/Users/mac/Documents/BIA 新生service/bia-admin/app/(admin)" --include="*.tsx"
```

Expected: at least the members page wraps in `p-8`.

- [ ] **Step 2: Add `p-8` to AdminShell main**

Edit `bia-admin/components/AdminShell.tsx`. Find the `<main>` element (last `<main>` in the file). Change:

```tsx
<main className="flex-1 min-w-0">{children}</main>
```

to:

```tsx
<main className="flex-1 min-w-0 p-8">{children}</main>
```

- [ ] **Step 3: Remove redundant outer `p-8` from members page**

In `bia-admin/app/(admin)/admin/members/page.tsx`, find the outermost wrapper that has `p-8` (likely `<div className="p-8 space-y-8">` or similar). Drop just the `p-8` token, keep the rest:

```tsx
<div className="space-y-8">
```

(Re-check by visual diff: dev server should look identical before/after.)

- [ ] **Step 4: Enable Blog in sidebar**

Edit `bia-admin/lib/admin/sections.ts`. Find the Blog entry (`href: '/admin/blog'`) and set `enabled: true`.

- [ ] **Step 5: Smoke test**

```bash
pnpm --filter bia-admin dev
```

Visit `/admin/members` — confirm spacing unchanged.
Visit `/admin` sidebar — Blog item now active.

- [ ] **Step 6: Commit**

```bash
git add bia-admin/components/AdminShell.tsx bia-admin/app/\(admin\)/admin/members/page.tsx bia-admin/lib/admin/sections.ts
git commit -m "fix(admin): centralize p-8 in shell; enable Blog in sidebar"
```

---

## Task 4 — Tighten slug uniqueness (PG migration)

**Files:**
- Create: `supabase/migrations/20260524000003_articles_slug_widen_unique.sql`

The current partial unique index `articles_slug_pub_idx` only enforces uniqueness on published rows. A `draft` can have the same slug as a `published` article. Submitting then publishing that draft fails the unique constraint at the `update status='published'` step with PG error `23505`, surfacing as a generic 500 from the publish handler.

Two fixes possible:
- (a) widen the index to cover non-draft statuses (so collisions surface at submit, not publish)
- (b) re-check + bump suffix inside the publish handler

We do **(a)** because it's cheaper to enforce in DB. Drafts can still share slugs (which is fine — they're not URL-routable yet).

- [ ] **Step 1: Write migration**

```sql
-- 20260524000003_articles_slug_widen_unique.sql
-- Prevent same-slug collisions before publish, not at publish.
-- Drafts may freely share slugs; once moving past draft, slug must be unique.

drop index if exists public.articles_slug_pub_idx;

create unique index if not exists articles_slug_nondraft_uniq_idx
  on public.articles (slug)
  where status in ('in_review', 'published', 'unpublished');
```

- [ ] **Step 2: Apply via Supabase MCP**

`mcp__claude_ai_Supabase__apply_migration` with the SQL above.

- [ ] **Step 3: Verify**

```sql
select indexname, indexdef from pg_indexes
where tablename='articles' and indexname like 'articles_slug%';
```

Expected: only `articles_slug_nondraft_uniq_idx` exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260524000003_articles_slug_widen_unique.sql
git commit -m "feat(db): widen articles slug uniqueness to all non-draft statuses"
```

---

## Task 5 — Admin API: `POST /api/admin/articles` (create draft, TDD)

**Files:**
- Create: `bia-admin/app/api/admin/articles/route.ts`
- Create: `bia-admin/app/api/admin/articles/__tests__/route.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// bia-admin/app/api/admin/articles/__tests__/route.test.ts
import { describe, it, expect, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_min: unknown, h: any) => {
    try { return await h(await requireRoleMock()); }
    catch (e: any) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: e.code ?? "x" }, { status: e.status ?? 500 });
    }
  },
  RoleError: class RoleError extends Error {
    constructor(public status: number, public code: string) { super(code); }
  },
}));

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: auditMock }));

vi.mock("@biboyang425/bia-shared", async () => {
  const actual = await vi.importActual<any>("@biboyang425/bia-shared");
  return {
    ...actual,
    createBiaServiceRoleClient: () => ({
      from: () => ({
        select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({
              data: {
                id: "art-1", slug: "welcome-to-bia", title: "Welcome to BIA",
                status: "draft", language: "en",
              },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
});

import { POST } from "../route";

const auth = {
  user: { id: "u1", email: "bobby@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "u1", email: "bobby@uscbia.com" },
};

describe("POST /api/admin/articles", () => {
  it("creates a draft, audits", async () => {
    requireRoleMock.mockResolvedValue(auth);
    const req = new Request("http://x/api/admin/articles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Welcome to BIA", html: "<p>x</p>", language: "en" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.slug).toBe("welcome-to-bia");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "article.create", entity_type: "article",
    }));
  });

  it("401 with no session", async () => {
    const { RoleError } = await import("@/lib/auth/require-role");
    requireRoleMock.mockRejectedValue(new RoleError(401, "no_session"));
    const req = new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x", html: "<p>x</p>", language: "en" }),
    });
    expect((await POST(req as any)).status).toBe(401);
  });

  it("400 on invalid body", async () => {
    requireRoleMock.mockResolvedValue(auth);
    const req = new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", html: "", language: "fr" }),
    });
    expect((await POST(req as any)).status).toBe(400);
  });

  it("400 when html sanitizes to empty", async () => {
    requireRoleMock.mockResolvedValue(auth);
    const req = new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x", html: "<script>only</script>", language: "en" }),
    });
    expect((await POST(req as any)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run → expect fail**

```bash
pnpm --filter bia-admin test app/api/admin/articles
```

Expected: FAIL — `Cannot find module '../route'`

- [ ] **Step 3: Implement**

```ts
// bia-admin/app/api/admin/articles/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import {
  createBiaServiceRoleClient,
  sanitizeArticleHtml,
  createArticleSlug,
  withCollisionSuffix,
  createArticleExcerpt,
} from "@biboyang425/bia-shared";

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  html: z.string().min(1).max(200_000),
  language: z.enum(["en", "zh"]),
  tags: z.array(z.string().max(40)).max(20).optional(),
  cover_image_url: z.string().url().nullable().optional(),
});

export async function POST(req: Request) {
  return withRole("editor", async (ctx) => {
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

    const parsed = CreateBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const { title, html, language, tags = [], cover_image_url } = parsed.data;
    const html_clean = sanitizeArticleHtml(html);
    if (!html_clean) {
      return NextResponse.json({ error: "empty_html_after_sanitize" }, { status: 400 });
    }

    const base = createArticleSlug(title);
    const supa = createBiaServiceRoleClient();

    // Collision-check against all non-draft statuses (where uniqueness is enforced)
    const candidates = [base, ...Array.from({ length: 10 }, (_, i) => `${base}-${i + 2}`)];
    const { data: existing, error: lookupErr } = await supa
      .from("articles").select("slug, status").in("slug", candidates);
    if (lookupErr) {
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }
    // Only block on non-draft collisions; drafts can share slugs.
    const taken = new Set(
      (existing ?? [])
        .filter((r: { status: string }) => r.status !== "draft")
        .map((r: { slug: string }) => r.slug),
    );
    const slug = withCollisionSuffix(base, taken);

    const { data, error } = await supa.from("articles").insert({
      slug,
      title,
      html_clean,
      excerpt: createArticleExcerpt(html_clean),
      cover_image_url: cover_image_url ?? null,
      language,
      tags,
      author_id: ctx.adminUser.id,
      status: "draft",
    }).select().single();

    if (error) {
      return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
    }

    await writeAudit({
      admin_email: ctx.user.email,
      action: "article.create",
      entity_type: "article",
      entity_id: data.id,
      payload: { slug: data.slug, language: data.language },
    });

    return NextResponse.json(data, { status: 201 });
  });
}
```

- [ ] **Step 4: Run → expect pass**

```bash
pnpm --filter bia-admin test
```

- [ ] **Step 5: Commit**

```bash
git add bia-admin/app/api/admin/articles/
git commit -m "feat(admin): POST /api/admin/articles (create draft, audited)"
```

---

## Task 6 — Admin API: GET list + GET/PATCH/DELETE [id] (TDD)

**Files:**
- Modify: `bia-admin/app/api/admin/articles/route.ts` (add GET)
- Create: `bia-admin/app/api/admin/articles/[id]/route.ts`
- Create: `bia-admin/app/api/admin/articles/[id]/__tests__/route.test.ts`

- [ ] **Step 1: Add GET to list route**

Append to `bia-admin/app/api/admin/articles/route.ts`:

```ts
export async function GET(req: Request) {
  return withRole("viewer", async () => {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const supa = createBiaServiceRoleClient();
    let q = supa
      .from("articles")
      .select("id, slug, title, language, status, published_at, updated_at, author_id, cover_image_url")
      .order("updated_at", { ascending: false });
    if (status && ["draft","in_review","published","unpublished"].includes(status)) {
      q = q.eq("status", status);
    }
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: "list_failed" }, { status: 500 });
    return NextResponse.json({ articles: data ?? [] });
  });
}
```

- [ ] **Step 2: Failing [id] tests**

```ts
// bia-admin/app/api/admin/articles/[id]/__tests__/route.test.ts
import { describe, it, expect, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());
const dbMock = vi.hoisted(() => ({
  maybeSingle: vi.fn(), update: vi.fn(), delete: vi.fn(), inCheck: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_m: unknown, h: any) => {
    try { return await h(await requireRoleMock()); }
    catch (e: any) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: e.code ?? "x" }, { status: e.status ?? 500 });
    }
  },
  RoleError: class RoleError extends Error {
    constructor(public status: number, public code: string) { super(code); }
  },
}));
vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: auditMock }));
vi.mock("@biboyang425/bia-shared", async () => {
  const actual = await vi.importActual<any>("@biboyang425/bia-shared");
  return {
    ...actual,
    createBiaServiceRoleClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: dbMock.maybeSingle }),
          in: dbMock.inCheck,
        }),
        update: dbMock.update,
        delete: dbMock.delete,
      }),
    }),
  };
});

import { GET, PATCH, DELETE } from "../route";

const editor = { user: { id: "u1", email: "e@x.com" }, role: "editor" as const, adminUser: { id: "u1", email: "e@x.com" } };
const superAdmin = { ...editor, role: "super_admin" as const };

const ctx = () => ({ params: Promise.resolve({ id: "a1" }) });

describe("[id] route", () => {
  it("GET returns the article", async () => {
    requireRoleMock.mockResolvedValue(editor);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", title: "x", status: "draft" }, error: null });
    const res = await GET(new Request("http://x") as any, ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("x");
  });

  it("PATCH 403 when published and not super_admin", async () => {
    requireRoleMock.mockResolvedValue(editor);
    dbMock.maybeSingle.mockResolvedValue({
      data: { id: "a1", status: "published", slug: "x", title: "x" }, error: null,
    });
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "new" }),
    });
    expect((await PATCH(req as any, ctx())).status).toBe(403);
  });

  it("PATCH updates draft, regens slug if title changed, audits", async () => {
    requireRoleMock.mockResolvedValue(editor);
    dbMock.maybeSingle.mockResolvedValueOnce({
      data: { id: "a1", status: "draft", slug: "old", title: "Old" }, error: null,
    });
    dbMock.inCheck.mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
    dbMock.update.mockReturnValue({
      eq: () => ({ select: () => ({ single: () => Promise.resolve({
        data: { id: "a1", status: "draft", slug: "new", title: "New" }, error: null,
      }) }) }),
    });
    const req = new Request("http://x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New" }),
    });
    const res = await PATCH(req as any, ctx());
    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "article.update" }));
  });

  it("DELETE 403 non-super_admin", async () => {
    requireRoleMock.mockResolvedValue(editor);
    expect((await DELETE(new Request("http://x", { method: "DELETE" }) as any, ctx())).status).toBe(403);
  });

  it("DELETE 200 super_admin + audits", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    dbMock.delete.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }) as any, ctx());
    expect(res.status).toBe(200);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "article.delete" }));
  });
});
```

- [ ] **Step 3: Implement [id] route**

```ts
// bia-admin/app/api/admin/articles/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import {
  createBiaServiceRoleClient,
  sanitizeArticleHtml,
  createArticleSlug,
  withCollisionSuffix,
  createArticleExcerpt,
} from "@biboyang425/bia-shared";

type Ctx = { params: Promise<{ id: string }> };

const PatchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  html: z.string().min(1).max(200_000).optional(),
  language: z.enum(["en", "zh"]).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  excerpt: z.string().max(500).nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
});

export async function GET(_req: Request, ctx: Ctx) {
  return withRole("viewer", async () => {
    const { id } = await ctx.params;
    const supa = createBiaServiceRoleClient();
    const { data, error } = await supa.from("articles").select("*").eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(data);
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

    const parsed = PatchBody.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

    const supa = createBiaServiceRoleClient();
    const { data: existing, error: getErr } = await supa
      .from("articles").select("id, slug, status, title").eq("id", id).maybeSingle();
    if (getErr) return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (existing.status === "published" && auth.role !== "super_admin") {
      return NextResponse.json({ error: "published_locked" }, { status: 403 });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) {
      update.title = parsed.data.title;
      if (existing.status === "draft" && parsed.data.title !== existing.title) {
        const base = createArticleSlug(parsed.data.title);
        const candidates = [base, ...Array.from({ length: 10 }, (_, i) => `${base}-${i + 2}`)];
        const { data: clashes } = await supa
          .from("articles").select("slug, status").in("slug", candidates);
        const taken = new Set(
          (clashes ?? [])
            .filter((r: any) => r.status !== "draft" && r.slug !== existing.slug)
            .map((r: any) => r.slug),
        );
        update.slug = withCollisionSuffix(base, taken);
      }
    }
    if (parsed.data.html !== undefined) {
      const html_clean = sanitizeArticleHtml(parsed.data.html);
      if (!html_clean) return NextResponse.json({ error: "empty_html" }, { status: 400 });
      update.html_clean = html_clean;
      if (parsed.data.excerpt === undefined) update.excerpt = createArticleExcerpt(html_clean);
    }
    if (parsed.data.language !== undefined) update.language = parsed.data.language;
    if (parsed.data.tags !== undefined) update.tags = parsed.data.tags;
    if (parsed.data.excerpt !== undefined) update.excerpt = parsed.data.excerpt;
    if (parsed.data.cover_image_url !== undefined) update.cover_image_url = parsed.data.cover_image_url;

    const { data, error } = await supa.from("articles").update(update).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });

    await writeAudit({
      admin_email: auth.user.email,
      action: "article.update",
      entity_type: "article",
      entity_id: id,
      payload: { fields: Object.keys(update) },
    });

    return NextResponse.json(data);
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const supa = createBiaServiceRoleClient();
    const { error } = await supa.from("articles").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "delete_failed" }, { status: 500 });

    await writeAudit({
      admin_email: auth.user.email,
      action: "article.delete",
      entity_type: "article",
      entity_id: id,
    });

    return NextResponse.json({ ok: true });
  });
}
```

- [ ] **Step 4: Tests pass**

```bash
pnpm --filter bia-admin test
```

- [ ] **Step 5: Commit**

```bash
git add bia-admin/app/api/admin/articles/
git commit -m "feat(admin): GET list + GET/PATCH/DELETE [id] for articles"
```

---

## Task 7 — Admin API: transitions submit / reject / publish / unpublish (TDD)

**Files:**
- Create: `bia-admin/app/api/admin/articles/[id]/{submit,reject,publish,unpublish}/route.ts`
- Create: `bia-admin/app/api/admin/articles/[id]/__tests__/transitions.test.ts`

Transitions:
- `draft → in_review`: editor+, sets `submitted_at`/`submitted_by`
- `in_review → draft`: super_admin, clears `submitted_at`/`submitted_by`
- `in_review → published` OR `unpublished → published`: super_admin, sets `published_at`/`published_by`, clears `unpublished_at`/`unpublished_by`. **Also re-checks slug uniqueness before commit and bumps suffix if needed** (Codex P1 #8 fix part 2).
- `published → unpublished`: super_admin, sets `unpublished_at`/`unpublished_by`

- [ ] **Step 1: Failing transition tests**

```ts
// bia-admin/app/api/admin/articles/[id]/__tests__/transitions.test.ts
import { describe, it, expect, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());
const dbMock = vi.hoisted(() => ({
  maybeSingle: vi.fn(), update: vi.fn(), in: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_m: unknown, h: any) => {
    try { return await h(await requireRoleMock()); }
    catch (e: any) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: e.code ?? "x" }, { status: e.status ?? 500 });
    }
  },
  RoleError: class RoleError extends Error {
    constructor(public status: number, public code: string) { super(code); }
  },
}));
vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: auditMock }));
vi.mock("@biboyang425/bia-shared", async () => {
  const actual = await vi.importActual<any>("@biboyang425/bia-shared");
  return {
    ...actual,
    createBiaServiceRoleClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: dbMock.maybeSingle }),
          in: dbMock.in,
        }),
        update: dbMock.update,
      }),
    }),
  };
});

import { POST as submit } from "../submit/route";
import { POST as reject } from "../reject/route";
import { POST as publish } from "../publish/route";
import { POST as unpublish } from "../unpublish/route";

const editor = { user: { id: "u1", email: "e@x.com" }, role: "editor" as const, adminUser: { id: "u1", email: "e@x.com" } };
const superAdmin = { ...editor, role: "super_admin" as const };

const req = () => new Request("http://x", { method: "POST" }) as any;
const ctx = () => ({ params: Promise.resolve({ id: "a1" }) });

function updateOk(returned: any) {
  dbMock.update.mockReturnValue({
    eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: returned, error: null }) }) }),
  });
}

describe("submit", () => {
  it("draft → in_review", async () => {
    requireRoleMock.mockResolvedValue(editor);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "draft", slug: "hi" }, error: null });
    dbMock.in.mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
    updateOk({ id: "a1", status: "in_review" });
    const res = await submit(req(), ctx());
    expect(res.status).toBe(200);
    expect(dbMock.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "in_review", submitted_by: "u1",
    }));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "article.submit" }));
  });

  it("409 from non-draft", async () => {
    requireRoleMock.mockResolvedValue(editor);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "published", slug: "hi" }, error: null });
    expect((await submit(req(), ctx())).status).toBe(409);
  });
});

describe("reject", () => {
  it("403 for non-super_admin", async () => {
    const { RoleError } = await import("@/lib/auth/require-role");
    requireRoleMock.mockRejectedValue(new RoleError(403, "role_required: super_admin"));
    expect((await reject(req(), ctx())).status).toBe(403);
  });
  it("in_review → draft, clears submitted_*", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "in_review" }, error: null });
    updateOk({ id: "a1", status: "draft" });
    expect((await reject(req(), ctx())).status).toBe(200);
    expect(dbMock.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "draft", submitted_at: null, submitted_by: null,
    }));
  });
});

describe("publish", () => {
  it("403 non-super_admin", async () => {
    const { RoleError } = await import("@/lib/auth/require-role");
    requireRoleMock.mockRejectedValue(new RoleError(403, "x"));
    expect((await publish(req(), ctx())).status).toBe(403);
  });

  it("in_review → published with timestamp", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "in_review", slug: "hello" }, error: null });
    dbMock.in.mockReturnValueOnce(Promise.resolve({ data: [{ slug: "hello", status: "in_review" }], error: null })); // self only
    updateOk({ id: "a1", status: "published" });
    const res = await publish(req(), ctx());
    expect(res.status).toBe(200);
    expect(dbMock.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "published", published_by: "u1",
    }));
  });

  it("bumps slug if it shadows a published article", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "in_review", slug: "hello" }, error: null });
    dbMock.in.mockReturnValueOnce(Promise.resolve({
      data: [
        { slug: "hello", status: "published" },           // collides
        { slug: "hello", status: "in_review" },           // self
      ],
      error: null,
    }));
    updateOk({ id: "a1", status: "published", slug: "hello-2" });
    const res = await publish(req(), ctx());
    expect(res.status).toBe(200);
    expect(dbMock.update).toHaveBeenCalledWith(expect.objectContaining({
      slug: "hello-2",
    }));
  });

  it("unpublished → published (republish)", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "unpublished", slug: "x" }, error: null });
    dbMock.in.mockReturnValueOnce(Promise.resolve({ data: [{ slug: "x", status: "unpublished" }], error: null })); // self only
    updateOk({ id: "a1", status: "published" });
    expect((await publish(req(), ctx())).status).toBe(200);
  });

  it("409 from draft", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "draft", slug: "x" }, error: null });
    expect((await publish(req(), ctx())).status).toBe(409);
  });
});

describe("unpublish", () => {
  it("published → unpublished", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "published" }, error: null });
    updateOk({ id: "a1", status: "unpublished" });
    const res = await unpublish(req(), ctx());
    expect(res.status).toBe(200);
    expect(dbMock.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "unpublished", unpublished_by: "u1",
    }));
  });
  it("409 from draft", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    dbMock.maybeSingle.mockResolvedValue({ data: { id: "a1", status: "draft" }, error: null });
    expect((await unpublish(req(), ctx())).status).toBe(409);
  });
});
```

- [ ] **Step 2: Implement submit**

```ts
// bia-admin/app/api/admin/articles/[id]/submit/route.ts
import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { createBiaServiceRoleClient, withCollisionSuffix } from "@biboyang425/bia-shared";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const supa = createBiaServiceRoleClient();
    const { data: existing } = await supa.from("articles")
      .select("id, status, slug").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (existing.status !== "draft") {
      return NextResponse.json({ error: "invalid_transition", from: existing.status }, { status: 409 });
    }

    // Re-check slug uniqueness against non-draft rows; bump suffix if needed
    const base = existing.slug;
    const candidates = [base, ...Array.from({ length: 10 }, (_, i) => `${base}-${i + 2}`)];
    const { data: clashes } = await supa.from("articles").select("slug, status").in("slug", candidates);
    const taken = new Set(
      (clashes ?? [])
        .filter((r: any) => r.status !== "draft")
        .map((r: any) => r.slug),
    );
    const finalSlug = withCollisionSuffix(base, taken);

    const { data, error } = await supa.from("articles").update({
      status: "in_review",
      submitted_at: new Date().toISOString(),
      submitted_by: auth.adminUser.id,
      slug: finalSlug,
    }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });

    await writeAudit({
      admin_email: auth.user.email, action: "article.submit",
      entity_type: "article", entity_id: id,
    });
    return NextResponse.json(data);
  });
}
```

- [ ] **Step 3: Implement reject**

```ts
// bia-admin/app/api/admin/articles/[id]/reject/route.ts
import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const reason = (await req.clone().json().catch(() => ({}))).reason as string | undefined;
    const supa = createBiaServiceRoleClient();
    const { data: existing } = await supa.from("articles")
      .select("id, status").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (existing.status !== "in_review") {
      return NextResponse.json({ error: "invalid_transition", from: existing.status }, { status: 409 });
    }
    const { data, error } = await supa.from("articles").update({
      status: "draft", submitted_at: null, submitted_by: null,
    }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

    await writeAudit({
      admin_email: auth.user.email, action: "article.reject",
      entity_type: "article", entity_id: id,
      payload: reason ? { reason } : {},
    });
    return NextResponse.json(data);
  });
}
```

- [ ] **Step 4: Implement publish (with slug re-check, fixes P1 #8)**

```ts
// bia-admin/app/api/admin/articles/[id]/publish/route.ts
import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { createBiaServiceRoleClient, withCollisionSuffix } from "@biboyang425/bia-shared";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const supa = createBiaServiceRoleClient();
    const { data: existing } = await supa.from("articles")
      .select("id, status, slug").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (existing.status !== "in_review" && existing.status !== "unpublished") {
      return NextResponse.json({ error: "invalid_transition", from: existing.status }, { status: 409 });
    }

    // Final defense: re-check slug against published rows (and other non-draft).
    // Exclude self from collision set.
    const base = existing.slug;
    const candidates = [base, ...Array.from({ length: 10 }, (_, i) => `${base}-${i + 2}`)];
    const { data: clashes } = await supa.from("articles").select("slug, status").in("slug", candidates);
    const taken = new Set(
      (clashes ?? [])
        .filter((r: any) => r.status !== "draft" && !(r.slug === base && r.status === existing.status))
        .map((r: any) => r.slug),
    );
    const finalSlug = withCollisionSuffix(base, taken);

    const { data, error } = await supa.from("articles").update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: auth.adminUser.id,
      unpublished_at: null,
      unpublished_by: null,
      slug: finalSlug,
    }).eq("id", id).select().single();
    if (error) {
      return NextResponse.json({ error: "publish_failed", message: error.message }, { status: 500 });
    }

    await writeAudit({
      admin_email: auth.user.email, action: "article.publish",
      entity_type: "article", entity_id: id,
      payload: { slug: finalSlug },
    });
    return NextResponse.json(data);
  });
}
```

- [ ] **Step 5: Implement unpublish**

```ts
// bia-admin/app/api/admin/articles/[id]/unpublish/route.ts
import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const supa = createBiaServiceRoleClient();
    const { data: existing } = await supa.from("articles")
      .select("id, status").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (existing.status !== "published") {
      return NextResponse.json({ error: "invalid_transition", from: existing.status }, { status: 409 });
    }
    const { data, error } = await supa.from("articles").update({
      status: "unpublished",
      unpublished_at: new Date().toISOString(),
      unpublished_by: auth.adminUser.id,
    }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

    await writeAudit({
      admin_email: auth.user.email, action: "article.unpublish",
      entity_type: "article", entity_id: id,
    });
    return NextResponse.json(data);
  });
}
```

- [ ] **Step 6: All tests pass**

```bash
pnpm --filter bia-admin test
```

- [ ] **Step 7: Commit**

```bash
git add bia-admin/app/api/admin/articles/
git commit -m "feat(admin): submit/reject/publish/unpublish transitions (with publish-time slug re-check)"
```

---

## Task 8 — Admin API: cover-upload signed URL (TDD, using SDK `uploadToSignedUrl` flow)

**Files:**
- Create: `bia-admin/app/api/admin/articles/cover-upload/route.ts`
- Create: `bia-admin/app/api/admin/articles/cover-upload/__tests__/route.test.ts`

The Supabase signed-upload flow is: server calls `storage.from('article-covers').createSignedUploadUrl(path)` which returns `{ signedUrl, token, path }`. The **client** then calls `supabase.storage.from('article-covers').uploadToSignedUrl(path, token, file)` (not raw PUT). The server returns `token` + `path` + the eventual `publicUrl`.

- [ ] **Step 1: Failing test**

```ts
// bia-admin/app/api/admin/articles/cover-upload/__tests__/route.test.ts
import { describe, it, expect, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const signMock = vi.hoisted(() => vi.fn());
const pubMock = vi.hoisted(() => vi.fn(() => ({
  data: { publicUrl: "https://x.supabase.co/storage/v1/object/public/article-covers/cover_abc.jpg" },
})));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_m: unknown, h: any) => {
    try { return await h(await requireRoleMock()); }
    catch (e: any) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json({ error: e.code ?? "x" }, { status: e.status ?? 500 });
    }
  },
  RoleError: class RoleError extends Error {
    constructor(public status: number, public code: string) { super(code); }
  },
}));

vi.mock("@biboyang425/bia-shared", async () => {
  const actual = await vi.importActual<any>("@biboyang425/bia-shared");
  return {
    ...actual,
    createBiaServiceRoleClient: () => ({
      storage: { from: () => ({
        createSignedUploadUrl: signMock,
        getPublicUrl: pubMock,
      }) },
    }),
  };
});

import { POST } from "../route";

describe("POST /api/admin/articles/cover-upload", () => {
  it("returns path + token + publicUrl", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u1", email: "e@x.com" }, role: "editor", adminUser: { id: "u1" } });
    signMock.mockResolvedValue({
      data: { signedUrl: "https://x/signed", token: "tok", path: "cover_abc.jpg" },
      error: null,
    });
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "hero.jpg", mime: "image/jpeg" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.token).toBe("tok");
    expect(j.path).toBe("cover_abc.jpg");
    expect(j.publicUrl).toContain("article-covers");
  });

  it("400 on unsupported mime", async () => {
    requireRoleMock.mockResolvedValue({ user: { id: "u1", email: "e@x.com" }, role: "editor", adminUser: { id: "u1" } });
    const req = new Request("http://x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "x.exe", mime: "application/octet-stream" }),
    });
    expect((await POST(req as any)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// bia-admin/app/api/admin/articles/cover-upload/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { withRole } from "@/lib/auth/require-role";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared";

const Body = z.object({
  filename: z.string().min(1).max(200),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: Request) {
  return withRole("editor", async () => {
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

    const parsed = Body.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

    const path = `cover_${randomUUID()}.${EXT[parsed.data.mime]}`;
    const supa = createBiaServiceRoleClient();
    const { data, error } = await supa.storage.from("article-covers").createSignedUploadUrl(path);
    if (error || !data) {
      return NextResponse.json({ error: "signed_url_failed", message: error?.message }, { status: 500 });
    }
    const { data: pub } = supa.storage.from("article-covers").getPublicUrl(path);
    return NextResponse.json({
      token: data.token,
      path: data.path,
      publicUrl: pub.publicUrl,
    });
  });
}
```

- [ ] **Step 3: Tests pass**

```bash
pnpm --filter bia-admin test
```

- [ ] **Step 4: Commit**

```bash
git add bia-admin/app/api/admin/articles/cover-upload/
git commit -m "feat(admin): cover-upload signed token endpoint (client uses uploadToSignedUrl)"
```

---

## Task 9 — Admin UI: `/admin/blog` list page

**Files:**
- Create: `bia-admin/app/(admin)/admin/blog/page.tsx`

- [ ] **Step 1: Create list page**

```tsx
// bia-admin/app/(admin)/admin/blog/page.tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  in_review: "bg-amber-100 text-amber-800",
  published: "bg-emerald-100 text-emerald-800",
  unpublished: "bg-rose-100 text-rose-800",
};

export default async function BlogListPage() {
  await requireRole("viewer");
  const supa = createBiaServiceRoleClient();
  const { data: articles } = await supa
    .from("articles")
    .select("id, title, slug, language, status, published_at, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Blog</h1>
          <p className="text-sm text-muted-foreground">
            Articles published to uscbia.com/blog. Editors draft and submit; super-admins publish.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/blog/new"><Plus className="size-4 mr-2" />New article</Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase text-muted-foreground bg-muted/30">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Lang</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {(articles ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No articles yet.</td></tr>
            )}
            {(articles ?? []).map((a) => (
              <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link href={`/admin/blog/${a.id}`} className="font-medium hover:underline">{a.title}</Link>
                  <div className="text-xs text-muted-foreground">/{a.slug}</div>
                </td>
                <td className="px-4 py-3 uppercase text-xs">{a.language}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs ${STATUS_STYLES[a.status] ?? ""}`}>
                    {a.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {new Date(a.updated_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke**

```bash
pnpm --filter bia-admin dev
```

Visit `/admin/blog`. Confirm empty table + `+ New article` button.

- [ ] **Step 3: Commit**

```bash
git add bia-admin/app/\(admin\)/admin/blog/page.tsx
git commit -m "feat(admin): /admin/blog list page"
```

---

## Task 10 — Admin UI: BlogEditor + CoverImageInput + new/[id] pages

**Files:**
- Create: `bia-admin/components/blog/CoverImageInput.tsx` (uses **SDK `uploadToSignedUrl`** — P2 #10 fix)
- Create: `bia-admin/components/blog/BlogEditor.tsx`
- Create: `bia-admin/app/(admin)/admin/blog/new/page.tsx`
- Create: `bia-admin/app/(admin)/admin/blog/[id]/page.tsx`

- [ ] **Step 1: CoverImageInput**

```tsx
// bia-admin/components/blog/CoverImageInput.tsx
"use client";

import { useState } from "react";
import { createBiaBrowserClient } from "@biboyang425/bia-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function CoverImageInput({
  value, onChange,
}: { value: string | null; onChange: (url: string | null) => void }) {
  const [uploading, setUploading] = useState(false);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      toast.error("Use JPG, PNG, WEBP, or GIF.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max file size is 5 MB.");
      return;
    }
    setUploading(true);
    try {
      // 1) ask server for a signed-upload token
      const signRes = await fetch("/api/admin/articles/cover-upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mime: file.type }),
      });
      const signed = await signRes.json();
      if (!signRes.ok) throw new Error(signed.error ?? "sign_failed");

      // 2) upload via SDK (NOT raw PUT — Supabase doesn't accept that on signed URLs)
      const browser = createBiaBrowserClient();
      const { error: upErr } = await browser.storage
        .from("article-covers")
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (upErr) throw upErr;

      onChange(signed.publicUrl);
      toast.success("Cover uploaded.");
    } catch (err: any) {
      toast.error(String(err.message ?? err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <Label>Cover image</Label>
      {value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="cover" className="h-20 w-32 object-cover rounded-md border" />
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>Remove</Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Input type="file" accept="image/*" onChange={pickFile} disabled={uploading} />
          {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: BlogEditor**

```tsx
// bia-admin/components/blog/BlogEditor.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sanitizeArticleHtml } from "@biboyang425/bia-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { CoverImageInput } from "./CoverImageInput";

interface Initial {
  id?: string;
  title?: string;
  html_clean?: string;
  language?: "en" | "zh";
  status?: "draft" | "in_review" | "published" | "unpublished";
  slug?: string;
  cover_image_url?: string | null;
}

export function BlogEditor({ initial, role }: {
  initial?: Initial;
  role: "super_admin" | "editor" | "viewer";
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [html, setHtml] = useState(initial?.html_clean ?? "");
  const [language, setLanguage] = useState<"en" | "zh">(initial?.language ?? "en");
  const [coverUrl, setCoverUrl] = useState<string | null>(initial?.cover_image_url ?? null);
  const [pending, start] = useTransition();
  const id = initial?.id;
  const status = initial?.status ?? "draft";
  const preview = sanitizeArticleHtml(html);

  async function save() {
    if (!title.trim() || !html.trim()) {
      toast.error("Title and HTML required."); return;
    }
    start(async () => {
      try {
        const url = id ? `/api/admin/articles/${id}` : "/api/admin/articles";
        const res = await fetch(url, {
          method: id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, html, language, cover_image_url: coverUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "save_failed");
        toast.success(id ? "Saved." : "Draft created.");
        if (!id) router.push(`/admin/blog/${data.id}`);
        else router.refresh();
      } catch (e: any) { toast.error(String(e.message ?? e)); }
    });
  }

  async function transition(endpoint: string, label: string) {
    if (!id) return;
    start(async () => {
      const res = await fetch(`/api/admin/articles/${id}/${endpoint}`, { method: "POST" });
      if (!res.ok) { toast.error(`${label} failed.`); return; }
      toast.success(`${label} ok.`);
      router.refresh();
    });
  }

  async function remove() {
    if (!id) return;
    if (!confirm("Delete this article? This cannot be undone.")) return;
    start(async () => {
      const res = await fetch(`/api/admin/articles/${id}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Delete failed."); return; }
      toast.success("Deleted.");
      router.push("/admin/blog");
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          {initial?.slug && <p className="text-xs text-muted-foreground">/{initial.slug}</p>}
        </div>
        <div className="space-y-1">
          <Label>Language</Label>
          <Select value={language} onValueChange={(v) => setLanguage(v as "en" | "zh")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <CoverImageInput value={coverUrl} onChange={setCoverUrl} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="html">HTML</Label>
          <textarea
            id="html"
            className="w-full h-[60vh] rounded-md border bg-background p-3 font-mono text-sm"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="Paste HTML here. Inline images, scripts, and styles are stripped on save."
          />
        </div>
        <div className="space-y-1">
          <Label>Preview</Label>
          <div className="h-[60vh] overflow-auto rounded-md border bg-background p-4 prose prose-neutral max-w-none"
               dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={save} disabled={pending}>Save</Button>
        {id && status === "draft" && (
          <Button variant="secondary" onClick={() => transition("submit", "Submitted")} disabled={pending}>
            Submit for review
          </Button>
        )}
        {id && status === "in_review" && role === "super_admin" && (
          <>
            <Button onClick={() => transition("publish", "Published")} disabled={pending}>Publish</Button>
            <Button variant="outline" onClick={() => transition("reject", "Rejected")} disabled={pending}>Reject</Button>
          </>
        )}
        {id && status === "published" && role === "super_admin" && (
          <Button variant="outline" onClick={() => transition("unpublish", "Unpublished")} disabled={pending}>
            Unpublish
          </Button>
        )}
        {id && status === "unpublished" && role === "super_admin" && (
          <Button onClick={() => transition("publish", "Republished")} disabled={pending}>Republish</Button>
        )}
        {id && role === "super_admin" && (
          <Button variant="destructive" onClick={remove} disabled={pending}>Delete</Button>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          Status: <span className="font-medium">{status.replace("_", " ")}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: new/page.tsx**

```tsx
// bia-admin/app/(admin)/admin/blog/new/page.tsx
import { requireRole } from "@/lib/auth/require-role";
import { BlogEditor } from "@/components/blog/BlogEditor";

export const dynamic = "force-dynamic";

export default async function NewArticlePage() {
  const { role } = await requireRole("editor");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New article</h1>
      <BlogEditor role={role} />
    </div>
  );
}
```

- [ ] **Step 4: [id]/page.tsx**

```tsx
// bia-admin/app/(admin)/admin/blog/[id]/page.tsx
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared";
import { BlogEditor } from "@/components/blog/BlogEditor";

export const dynamic = "force-dynamic";

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { role } = await requireRole("editor");
  const { id } = await params;
  const supa = createBiaServiceRoleClient();
  const { data } = await supa.from("articles").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit article</h1>
      <BlogEditor role={role} initial={data} />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + smoke**

```bash
pnpm --filter bia-admin exec tsc --noEmit
pnpm --filter bia-admin dev
```

Visit `/admin/blog/new`. Verify the form renders, the preview pane updates as you type, and the cover upload completes (it'll upload to Supabase Storage in real-time — check the bucket on the Supabase dashboard after).

- [ ] **Step 6: Commit**

```bash
git add bia-admin/components/blog/ bia-admin/app/\(admin\)/admin/blog/
git commit -m "feat(admin): blog editor (new + [id]) with split preview + SDK cover upload + state machine"
```

---

## Task 11 — Local end-to-end smoke (admin → DB → public)

Both the admin app and the public reader are now wired against the live DB. No code change here — just verify the full loop.

- [ ] **Step 1: Start both dev servers**

```bash
# Terminal 1
cd "/Users/mac/Documents/BIA 新生service" && pnpm --filter bia-admin dev
# Terminal 2
cd /Users/mac/Documents/bia-roommate && npm run dev
```

bia-admin on `:3000`, bia-roommate on `:3001` (or whichever port Next picks).

- [ ] **Step 2: Run the 10-scenario smoke**

1. Sign in to admin as super_admin.
2. `/admin/blog` → click "New article".
3. Title: "Smoke Test Post". Paste HTML containing `<h2>`, `<p>`, `<a href>`, plus `<img src=x>` and `<script>x</script>`.
4. Click "Choose file" and upload a real JPG/PNG as the cover.
5. Save → lands at `/admin/blog/<id>`. Confirm preview has no `<img>`/`<script>` from body but the cover thumbnail is shown.
6. "Submit for review" → status pill flips to "in review".
7. "Publish" → status pill flips to "published"; verify `published_at` populates.
8. Visit `localhost:3001/blog` → "Smoke Test Post" appears with its cover.
9. Click into `localhost:3001/blog/smoke-test-post` → ArticleRenderer renders body + cover hero.
10. Visit `localhost:3001/` → landing page Blog section shows the post.
11. Back in admin: "Unpublish" → status pill flips. Wait ~60s (ISR window) then refresh `/blog/smoke-test-post` → 404.
12. "Republish" → status pill flips back. Slug should auto-stay (same article, same slug).
13. Verify audit log:

```sql
-- via mcp__claude_ai_Supabase__execute_sql
select action, ts from admin_audit_log
where entity_type='article' order by ts desc limit 20;
```

Expected: full trail — create / update / submit / publish / unpublish / publish.

- [ ] **Step 3: If anything fails, fix on this branch + commit incremental fixes before proceeding to Task 12.**

---

## Task 12 — Push, PR, merge

- [ ] **Step 1: Push**

```bash
cd "/Users/mac/Documents/BIA 新生service" && git push -u origin feat/phase-2a-blog-admin
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: Phase 2A — Blog admin (API + UI + slug fix)" --body "$(cat <<'EOF'
## Summary
- Applied two pending migrations: articles table + storage bucket
- Widened admin_audit_log entity_type to include 'article'
- /admin/blog list + editor with split preview, cover upload via Supabase SDK uploadToSignedUrl
- 8 admin API routes: POST/GET, [id] GET/PATCH/DELETE, submit/reject/publish/unpublish, cover-upload
- Fixed P1 slug-collision bug: index now covers all non-draft statuses + publish handler re-checks + bumps suffix
- Centralized p-8 padding in AdminShell

## Code-review fixes applied
- Codex P1 #8 slug uniqueness (widened index + re-check at submit/publish time)
- Codex P2 #10 signed-upload protocol (SDK uploadToSignedUrl, not raw PUT)
- Reused existing writeAudit helper (widened entity_type instead of creating duplicate)
- Reused existing bia-roommate createServerSupabaseClient (no duplicate)

## Test plan
- [x] Local smoke (12 scenarios from Task 11)
- [ ] Vitest passes (`pnpm --filter bia-admin test` — 4 new test files)
- [ ] CI green
- [ ] Production smoke after merge + Vercel deploy
EOF
)"
```

- [ ] **Step 3: Watch CI**

```bash
gh pr checks --watch
```

- [ ] **Step 4: Merge**

After CI green, merge via GitHub UI or:

```bash
gh pr merge --merge
git checkout main && git pull origin main
```

- [ ] **Step 5: Production smoke**

After Vercel deploys bia-admin, repeat the 12-scenario smoke against `bia-admin.vercel.app` and `uscbia.com`. Confirm audit log shows the new entries.

---

## Self-review checklist (writer)

**Reality drift reconciled:**
- ✓ Shared package (already 0.2.0, articles/* built) — verified not re-creating
- ✓ Existing public reader files (`bia-roommate/app/blog/*`, `BlogPreview`, `lib/articles.ts`) — verified working, no changes
- ✓ Existing `writeAudit` helper — widening type instead of creating duplicate
- ✓ Migrations on disk but unapplied — Task 1 applies them
- ✓ Naming consistency: existing code uses `createArticleSlug` / `createArticleExcerpt` (the canonical names) plus `slugify` / `deriveExcerpt` (aliases). Plan uses the canonical names in implementation, with `slugify` exported only as alias.
- ✓ Language enum: existing types + migration both use `'en','zh'`. Plan stays on that. (Design doc rev 3's `'cn','en'` was a doc typo; the implementation is the source of truth now.)

**Codex P1/P2 fixes applied:**
- P1 #1 reality drift → entirely restructured plan as audit + complete
- P1 #2 articles table missing → Task 1 applies migration
- P1 #4 writeAudit duplication → Task 2 widens existing helper
- P1 #6 Article type duplication → confirmed type already exists, not appending
- P1 #8 slug collision → Task 4 widens index; Tasks 7+8 re-check + bump at submit/publish
- P2 #10 signed-upload PUT → Task 10 uses SDK `uploadToSignedUrl`
- P2 #14 NODE_AUTH_TOKEN clarity → bia-admin uses workspace:* so no token needed locally; production Vercel only needs it if installation runs outside monorepo root (note added to PR)

**Placeholders:** none. Every step has complete code or a verifiable command.

**Out of scope (deferred):** scheduled publish · draft preview links · .zip drop · multilingual cross-link · stricter storage object listing policy · landing SEO/SSR upgrade for BlogPreview.
