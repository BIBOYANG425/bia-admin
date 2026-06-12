# Slice C — Marketplace Event-Submission Approval Queue + Cap Enforcement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let BIA officers review student-submitted community events in the admin dashboard — approve (promotes the submission into the live `events` table) or reject (with a reason) — with a 20-approvals-per-week marketplace cap.

**Architecture:** Reuse the existing `event_submissions` table (george's `submit_event` tool already enqueues rows there with `status='pending'`). Add three decision-tracking columns. Build two POST API routes (`approve`, `reject`) under `app/api/admin/event-submissions/[id]/`, a server-component queue page that reads pending submissions directly via the service-role client (same pattern as the events page), and a small client component for the approve/reject buttons. Approval inserts a row into `events` (`source='community'`, `status='active'`) and links it back via `event_submissions.approved_event_id`. A pure-ish cap helper counts approvals in the trailing 7 days and blocks approval at 20.

**Tech Stack:** Next.js 16 App Router (TypeScript), Supabase (service-role client from `@biboyang425/bia-shared`), Zod v3 validation, Vitest + `vi.mock`, shadcn `Table`/`Button` UI, `lucide-react` icons. Schema migration applied to Supabase project `ujkaregrwrppaehvbahf` via the Supabase MCP `apply_migration`.

---

## Ground truth (verified against live repo + DB, 2026-06-11)

- **`event_submissions` already exists** (0 rows). Columns: `id uuid pk default gen_random_uuid()`, `student_id uuid`, `title text NOT NULL`, `description text`, `date timestamptz`, `location text`, `status text DEFAULT 'pending'`, `created_at timestamptz DEFAULT now()`, `approved_event_id uuid`, `category text`. **Do not recreate it.**
- **`events`** columns used on insert: `title NOT NULL`, `description`, `date`, `end_date`, `location`, `category`, `source text NOT NULL`, `source_url`, `image_url`, `capacity`, `status`, `is_featured boolean NOT NULL` (has a DB default — do **not** set it). `source` values seen in UI: `bia`, `usc`, `instagram`, `community`. `status` values: `active`, `cancelled`, `past`.
- **`admin_audit_log`** columns: `admin_email text NOT NULL`, `action text NOT NULL`, `entity_type text NOT NULL`, `entity_id text` (nullable, **text not uuid**), `payload jsonb NOT NULL`, `ts timestamptz NOT NULL`. Always written through `writeAudit()` in `lib/admin/audit-log.ts`.
- **Auth gate:** `withRole(min, async (auth) => NextResponse)` from `@/lib/auth/require-role`. `auth.user.email` (string), `auth.adminUser.id` (uuid string). Role order: `viewer < editor < super_admin`. Events POST/checkin use `editor`; we use `editor` for approve/reject.
- **Route handler shape:** `interface RouteContext { params: Promise<{ id: string }> }`, then `const { id } = await ctx.params`.
- **Service-role client:** `import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role"`. In server components the same import is used.
- **Tests:** runner is Vitest (`pnpm test` → `vitest run`, config `vitest.config.ts`, `@` alias → repo root, include `**/__tests__/**/*.test.ts`). Mock pattern: `vi.hoisted` + `vi.mock("@/lib/auth/require-role", …)` + `vi.mock("@biboyang425/bia-shared/supabase/service-role", …)`.
- **Sidebar:** `lib/admin/sections.ts` → `ADMIN_SECTIONS` array. There is already a disabled `Squad` (Phase 2) entry; events live in the `content` group.
- **Cap basis:** `events` has **no** `approved_at` column, so count approvals via `event_submissions WHERE status='approved' AND decided_at >= now() - 7 days`.
- **No bia-shared change.** All new types are local to bia-admin to avoid a shared-package version bump + publish cycle. (`audit-log.ts`'s `entity_type` union is a local type — extend it there.)
- **george needs no change** — `submit_event` already inserts into `event_submissions`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/20260611120000_event_submissions_decision_fields.sql` | Add `decided_by`, `decided_at`, `reject_reason` + a cap-query index | Create |
| `lib/admin/audit-log.ts` | Add `"event_submission"` to the `entity_type` union | Modify |
| `lib/marketplace/cap-enforcement.ts` | `MARKETPLACE_WEEKLY_CAP` + `countApprovedSubmissionsThisWeek()` | Create |
| `lib/marketplace/__tests__/cap-enforcement.test.ts` | Boundary tests (19/20/21, error path) | Create |
| `app/api/admin/event-submissions/[id]/approve/route.ts` | POST approve → insert event + mark submission | Create |
| `app/api/admin/event-submissions/[id]/approve/__tests__/route.test.ts` | Approve happy path, 404, 409, cap 429, unauthorized | Create |
| `app/api/admin/event-submissions/[id]/reject/route.ts` | POST reject → mark submission rejected + reason | Create |
| `app/api/admin/event-submissions/[id]/reject/__tests__/route.test.ts` | Reject happy path, 404, 409, unauthorized | Create |
| `app/(admin)/admin/marketplace/page.tsx` | Server component: list pending submissions + cap banner | Create |
| `app/(admin)/admin/marketplace/MarketplaceQueue.tsx` | Client component: approve/reject buttons | Create |
| `lib/admin/sections.ts` | Add the `活动投稿` sidebar entry | Modify |

---

### Task 1: Migration — decision columns on `event_submissions`

**Files:**
- Create: `supabase/migrations/20260611120000_event_submissions_decision_fields.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Slice C: decision-tracking for the marketplace approval queue.
-- event_submissions already exists (george's submit_event enqueues 'pending'
-- rows). These columns record who decided, when, and why (on reject).
-- Append-only: never edit a migration that has been applied.

alter table public.event_submissions
  add column if not exists decided_by uuid references public.admin_users(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists reject_reason text;

-- Cap query: count approvals in a trailing 7-day window.
create index if not exists event_submissions_status_decided_at_idx
  on public.event_submissions (status, decided_at);
```

- [ ] **Step 2: Apply via the Supabase MCP**

Use the Supabase MCP `apply_migration` against project `ujkaregrwrppaehvbahf` with:
- `name`: `event_submissions_decision_fields`
- `query`: the SQL above.

(If the MCP is unavailable, run `supabase migration up` per `CLAUDE.md` "How to deploy".)

- [ ] **Step 3: Verify the columns landed**

Run the Supabase MCP `execute_sql` against `ujkaregrwrppaehvbahf`:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='event_submissions'
  and column_name in ('decided_by','decided_at','reject_reason')
order by column_name;
```

Expected: three rows — `decided_at`, `decided_by`, `reject_reason`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260611120000_event_submissions_decision_fields.sql
git commit -m "feat(marketplace): add decision columns to event_submissions"
```

---

### Task 2: Extend the audit `entity_type` union

**Files:**
- Modify: `lib/admin/audit-log.ts:6`

- [ ] **Step 1: Add `"event_submission"` to the union**

Change the `entity_type` line in `AuditEntry`:

```ts
export interface AuditEntry {
  admin_email: string;
  action: string;
  entity_type: "admin_user" | "admin_invitation" | "article" | "event_submission";
  entity_id?: string | null;
  payload?: Record<string, unknown>;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors (the union is widened; existing callers still compile).

- [ ] **Step 3: Commit**

```bash
git add lib/admin/audit-log.ts
git commit -m "feat(marketplace): allow event_submission audit entity_type"
```

---

### Task 3: Cap-enforcement helper

**Files:**
- Create: `lib/marketplace/cap-enforcement.ts`
- Test: `lib/marketplace/__tests__/cap-enforcement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/marketplace/__tests__/cap-enforcement.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  MARKETPLACE_WEEKLY_CAP,
  countApprovedSubmissionsThisWeek,
} from "../cap-enforcement";

// Minimal chainable mock of the supabase query used by the helper:
//   admin.from(t).select(c, {count, head}).eq(k, v).gte(k, v)  -> { count, error }
function fakeAdmin(result: { count?: number | null; error?: unknown }) {
  const thenable = {
    eq() {
      return this;
    },
    gte() {
      return Promise.resolve(result);
    },
  };
  return {
    from: vi.fn(() => ({ select: () => thenable })),
  };
}

describe("countApprovedSubmissionsThisWeek", () => {
  it("returns the count when the query succeeds", async () => {
    const admin = fakeAdmin({ count: 7, error: null });
    expect(await countApprovedSubmissionsThisWeek(admin as never)).toBe(7);
  });

  it("treats a null count as 0", async () => {
    const admin = fakeAdmin({ count: null, error: null });
    expect(await countApprovedSubmissionsThisWeek(admin as never)).toBe(0);
  });

  it("throws on a query error", async () => {
    const admin = fakeAdmin({ count: null, error: { message: "boom" } });
    await expect(countApprovedSubmissionsThisWeek(admin as never)).rejects.toThrow("boom");
  });

  it("exposes the weekly cap constant as 20", () => {
    expect(MARKETPLACE_WEEKLY_CAP).toBe(20);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run lib/marketplace/__tests__/cap-enforcement.test.ts`
Expected: FAIL — `Cannot find module '../cap-enforcement'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/marketplace/cap-enforcement.ts
// Marketplace approval cap: at most MARKETPLACE_WEEKLY_CAP student-submitted
// events may be APPROVED in any trailing 7-day window. Counts approvals via
// event_submissions (events has no approved_at column). Pure of HTTP — the
// approve route calls this and maps an over-cap result to HTTP 429.
import type { SupabaseClient } from "@supabase/supabase-js";

export const MARKETPLACE_WEEKLY_CAP = 20;

/** Count submissions approved in the trailing 7 days. Throws on query error. */
export async function countApprovedSubmissionsThisWeek(
  admin: SupabaseClient,
): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("event_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved")
    .gte("decided_at", since);
  if (error) throw new Error((error as { message?: string }).message ?? "cap_query_failed");
  return count ?? 0;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run lib/marketplace/__tests__/cap-enforcement.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/marketplace/cap-enforcement.ts lib/marketplace/__tests__/cap-enforcement.test.ts
git commit -m "feat(marketplace): weekly approval cap helper"
```

---

### Task 4: Approve API route

**Files:**
- Create: `app/api/admin/event-submissions/[id]/approve/route.ts`
- Test: `app/api/admin/event-submissions/[id]/approve/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/api/admin/event-submissions/[id]/approve/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, capMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
  capMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_min: unknown, handler: any) => {
    try {
      return await handler(await requireRoleMock());
    } catch (error: any) {
      if (typeof error?.status === "number" && typeof error?.code === "string") {
        const { NextResponse } = await import("next/server");
        return NextResponse.json({ error: error.code }, { status: error.status });
      }
      throw error;
    }
  },
  RoleError: class RoleError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({ from: fromMock }),
}));

vi.mock("@/lib/marketplace/cap-enforcement", () => ({
  MARKETPLACE_WEEKLY_CAP: 20,
  countApprovedSubmissionsThisWeek: capMock,
}));

const auditMock = vi.fn();
vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: auditMock }));

import { POST } from "../route";

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};
const SUB_ID = "11111111-1111-1111-1111-111111111111";

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req() {
  return new Request("http://localhost/api/admin/event-submissions/x/approve", {
    method: "POST",
  });
}

// Builds a fromMock where the submission lookup returns `submission`, the events
// insert returns a new id, and the submission update succeeds.
function wireHappyPath(submission: Record<string, unknown>) {
  fromMock.mockImplementation((table: string) => {
    if (table === "event_submissions") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: submission, error: null }) }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === "events") {
      return {
        insert: () => ({
          select: () => ({ single: () => Promise.resolve({ data: { id: "ev-9" }, error: null }) }),
        }),
      };
    }
    return {};
  });
}

beforeEach(() => {
  requireRoleMock.mockReset();
  fromMock.mockReset();
  capMock.mockReset();
  auditMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
  capMock.mockResolvedValue(0);
});

describe("POST /api/admin/event-submissions/[id]/approve", () => {
  it("approves a pending submission: inserts an event and links it back", async () => {
    let insertedEvent: any = null;
    let submissionUpdate: any = null;
    fromMock.mockImplementation((table: string) => {
      if (table === "event_submissions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: SUB_ID,
                    status: "pending",
                    title: "Boba Night",
                    description: "come thru",
                    date: null,
                    location: "TCC",
                    category: "social",
                  },
                  error: null,
                }),
            }),
          }),
          update: (row: any) => {
            submissionUpdate = row;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === "events") {
        return {
          insert: (row: any) => {
            insertedEvent = row;
            return {
              select: () => ({ single: () => Promise.resolve({ data: { id: "ev-9" }, error: null }) }),
            };
          },
        };
      }
      return {};
    });

    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, event_id: "ev-9" });
    expect(insertedEvent).toMatchObject({
      title: "Boba Night",
      location: "TCC",
      category: "social",
      source: "community",
      status: "active",
    });
    expect(submissionUpdate).toMatchObject({
      status: "approved",
      approved_event_id: "ev-9",
      decided_by: "e1",
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event_submission.approve",
        entity_type: "event_submission",
        entity_id: SUB_ID,
      }),
    );
  });

  it("404s when the submission does not exist", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("409s when the submission is not pending", async () => {
    wireHappyPath({ id: SUB_ID, status: "approved", title: "x" });
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invalid_transition");
  });

  it("429s when the weekly cap is reached", async () => {
    capMock.mockResolvedValue(20);
    wireHappyPath({ id: SUB_ID, status: "pending", title: "x" });
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("cap_reached");
  });

  it("403s a viewer (role gate)", async () => {
    requireRoleMock.mockRejectedValue(
      Object.assign(new Error("role_required: editor"), { status: 403, code: "role_required: editor" }),
    );
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run app/api/admin/event-submissions` (bracket-free filter — vitest treats positional args as regex, so the literal `[id]` segment must not be passed)
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Write the implementation**

```ts
// app/api/admin/event-submissions/[id]/approve/route.ts
// POST /api/admin/event-submissions/[id]/approve — promote a pending student
// event submission into the live events table (editor+). Enforces the weekly
// marketplace cap. Idempotency guard: only 'pending' submissions can be approved.
import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import {
  MARKETPLACE_WEEKLY_CAP,
  countApprovedSubmissionsThisWeek,
} from "@/lib/marketplace/cap-enforcement";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const { data: sub, error: lookupError } = await admin
      .from("event_submissions")
      .select("id, status, title, description, date, location, category")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json(
        { error: "lookup_failed", details: lookupError.message },
        { status: 500 },
      );
    }
    if (!sub) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (sub.status !== "pending") {
      return NextResponse.json(
        { error: "invalid_transition", from: sub.status },
        { status: 409 },
      );
    }

    const approvedThisWeek = await countApprovedSubmissionsThisWeek(admin);
    if (approvedThisWeek >= MARKETPLACE_WEEKLY_CAP) {
      return NextResponse.json(
        { error: "cap_reached", cap: MARKETPLACE_WEEKLY_CAP },
        { status: 429 },
      );
    }

    const { data: event, error: insertError } = await admin
      .from("events")
      .insert({
        title: sub.title,
        description: sub.description ?? null,
        date: sub.date ?? null,
        location: sub.location ?? null,
        category: sub.category ?? null,
        source: "community",
        status: "active",
      })
      .select("id")
      .single();
    if (insertError || !event) {
      return NextResponse.json(
        { error: "create_failed", details: insertError?.message },
        { status: 500 },
      );
    }

    const { error: updateError } = await admin
      .from("event_submissions")
      .update({
        status: "approved",
        approved_event_id: event.id,
        decided_by: auth.adminUser.id,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) {
      return NextResponse.json(
        { error: "update_failed", details: updateError.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "event_submission.approve",
      entity_type: "event_submission",
      entity_id: id,
      payload: { event_id: event.id },
    });

    return NextResponse.json({ ok: true, event_id: event.id });
  });
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run app/api/admin/event-submissions` (bracket-free filter — vitest treats positional args as regex, so the literal `[id]` segment must not be passed)
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/event-submissions/[id]/approve/"
git commit -m "feat(marketplace): approve route promotes submission to event"
```

---

### Task 5: Reject API route

**Files:**
- Create: `app/api/admin/event-submissions/[id]/reject/route.ts`
- Test: `app/api/admin/event-submissions/[id]/reject/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/api/admin/event-submissions/[id]/reject/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_min: unknown, handler: any) => {
    try {
      return await handler(await requireRoleMock());
    } catch (error: any) {
      if (typeof error?.status === "number" && typeof error?.code === "string") {
        const { NextResponse } = await import("next/server");
        return NextResponse.json({ error: error.code }, { status: error.status });
      }
      throw error;
    }
  },
  RoleError: class RoleError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({ from: fromMock }),
}));

const auditMock = vi.fn();
vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: auditMock }));

import { POST } from "../route";

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};
const SUB_ID = "22222222-2222-2222-2222-222222222222";

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body?: unknown) {
  return new Request("http://localhost/api/admin/event-submissions/x/reject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function wirePending(status = "pending") {
  let captured: any = null;
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: SUB_ID, status }, error: null }) }),
    }),
    update: (row: any) => {
      captured = row;
      return { eq: () => Promise.resolve({ error: null }) };
    },
  }));
  return () => captured;
}

beforeEach(() => {
  requireRoleMock.mockReset();
  fromMock.mockReset();
  auditMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
});

describe("POST /api/admin/event-submissions/[id]/reject", () => {
  it("rejects a pending submission with a reason and audits it", async () => {
    const captured = wirePending();
    const res = await POST(req({ reason: "off-topic" }), ctxFor(SUB_ID));
    expect(res.status).toBe(200);
    expect(captured()).toMatchObject({
      status: "rejected",
      reject_reason: "off-topic",
      decided_by: "e1",
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event_submission.reject",
        entity_type: "event_submission",
        entity_id: SUB_ID,
        payload: { reason: "off-topic" },
      }),
    );
  });

  it("rejects without a reason (reason becomes null)", async () => {
    const captured = wirePending();
    const res = await POST(req({}), ctxFor(SUB_ID));
    expect(res.status).toBe(200);
    expect(captured()).toMatchObject({ status: "rejected", reject_reason: null });
  });

  it("404s when the submission does not exist", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));
    const res = await POST(req({ reason: "x" }), ctxFor(SUB_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("409s when the submission is not pending", async () => {
    wirePending("rejected");
    const res = await POST(req({ reason: "x" }), ctxFor(SUB_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invalid_transition");
  });

  it("403s a viewer (role gate)", async () => {
    requireRoleMock.mockRejectedValue(
      Object.assign(new Error("role_required: editor"), { status: 403, code: "role_required: editor" }),
    );
    const res = await POST(req({ reason: "x" }), ctxFor(SUB_ID));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run app/api/admin/event-submissions` (bracket-free filter — vitest treats positional args as regex, so the literal `[id]` segment must not be passed)
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Write the implementation**

```ts
// app/api/admin/event-submissions/[id]/reject/route.ts
// POST /api/admin/event-submissions/[id]/reject — decline a pending student
// event submission (editor+). Optional body { reason?: string }. Only 'pending'
// submissions can be rejected.
import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const reason =
      typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    const admin = createBiaServiceRoleClient();

    const { data: sub, error: lookupError } = await admin
      .from("event_submissions")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json(
        { error: "lookup_failed", details: lookupError.message },
        { status: 500 },
      );
    }
    if (!sub) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (sub.status !== "pending") {
      return NextResponse.json(
        { error: "invalid_transition", from: sub.status },
        { status: 409 },
      );
    }

    const { error: updateError } = await admin
      .from("event_submissions")
      .update({
        status: "rejected",
        reject_reason: reason,
        decided_by: auth.adminUser.id,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) {
      return NextResponse.json(
        { error: "update_failed", details: updateError.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "event_submission.reject",
      entity_type: "event_submission",
      entity_id: id,
      payload: reason ? { reason } : {},
    });

    return NextResponse.json({ ok: true });
  });
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run app/api/admin/event-submissions` (bracket-free filter — vitest treats positional args as regex, so the literal `[id]` segment must not be passed)
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/api/admin/event-submissions/[id]/reject/"
git commit -m "feat(marketplace): reject route with reason + audit"
```

---

### Task 6: Queue page (server component) + client buttons

**Files:**
- Create: `app/(admin)/admin/marketplace/page.tsx`
- Create: `app/(admin)/admin/marketplace/MarketplaceQueue.tsx`

This task is UI; it has no unit test (the existing admin pages, e.g. `app/(admin)/admin/events/page.tsx`, have none — verify visually in Step 4). Keep the data shape identical to what the API routes expect.

- [ ] **Step 1: Write the client component**

```tsx
// app/(admin)/admin/marketplace/MarketplaceQueue.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export interface PendingSubmission {
  id: string;
  title: string;
  description: string | null;
  date: string | null;
  location: string | null;
  category: string | null;
  created_at: string | null;
}

function fmt(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function MarketplaceQueue({
  submissions,
  capReached,
}: {
  submissions: PendingSubmission[];
  capReached: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setError(null);
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt("拒绝原因（可留空）：") ?? null;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/event-submissions/${id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "reject" ? JSON.stringify({ reason }) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === "cap_reached" ? "本周审核已达上限（20）" : `操作失败：${data.error ?? res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">没有待审核的投稿 🎉</p>;
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {submissions.map((s) => (
        <div key={s.id} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground">
                {fmt(s.date)} · {s.location ?? "地点未填"} · {s.category ?? "未分类"}
              </p>
              {s.description ? (
                <p className="text-sm text-muted-foreground line-clamp-3">{s.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={busyId === s.id || capReached}
                title={capReached ? "本周审核已达上限" : undefined}
                onClick={() => act(s.id, "approve")}
              >
                通过
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === s.id}
                onClick={() => act(s.id, "reject")}
              >
                拒绝
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write the server-component page**

```tsx
// app/(admin)/admin/marketplace/page.tsx
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { requireRole } from "@/lib/auth/require-role";
import {
  MARKETPLACE_WEEKLY_CAP,
  countApprovedSubmissionsThisWeek,
} from "@/lib/marketplace/cap-enforcement";
import { MarketplaceQueue, type PendingSubmission } from "./MarketplaceQueue";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  await requireRole("viewer");

  const admin = createBiaServiceRoleClient();
  const { data, error } = await admin
    .from("event_submissions")
    .select("id, title, description, date, location, category, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    throw new Error(`Failed to load submissions: ${error.message}`);
  }
  const submissions = (data ?? []) as PendingSubmission[];
  const approvedThisWeek = await countApprovedSubmissionsThisWeek(admin);
  const capReached = approvedThisWeek >= MARKETPLACE_WEEKLY_CAP;

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">活动投稿审核</h1>
        <p className="text-sm text-muted-foreground">
          {submissions.length} 条待审核 · 本周已通过 {approvedThisWeek} / {MARKETPLACE_WEEKLY_CAP}
        </p>
      </header>
      {capReached ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          本周审核通过数已达上限（{MARKETPLACE_WEEKLY_CAP}）。通过按钮已禁用，下周重置。
        </div>
      ) : null}
      <MarketplaceQueue submissions={submissions} capReached={capReached} />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke (optional, needs local dev + a pending row)**

Run `pnpm dev`, sign in, visit `http://localhost:3000/admin/marketplace`. With no pending rows it shows "没有待审核的投稿 🎉". (Inserting a test row is optional — the API routes are covered by unit tests.)

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/marketplace/"
git commit -m "feat(marketplace): approval queue page + approve/reject UI"
```

---

### Task 7: Sidebar entry

**Files:**
- Modify: `lib/admin/sections.ts:44`

- [ ] **Step 1: Add the import for an icon**

In the `lucide-react` import block at the top of `lib/admin/sections.ts`, add `ClipboardCheck` (keep the list alphabetical-ish, matching existing style):

```ts
import {
  Boxes,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Contact,
  Newspaper,
  Package,
  Route,
  Ship,
  Star,
  UserRound,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";
```

- [ ] **Step 2: Add the section row**

Insert directly after the `活动` (events) row in `ADMIN_SECTIONS`:

```ts
  { href: "/admin/events",      label: "活动",     icon: Calendar,       group: "content",   enabled: true },
  { href: "/admin/marketplace", label: "活动投稿", icon: ClipboardCheck, group: "content",   enabled: true },
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/admin/sections.ts
git commit -m "feat(marketplace): sidebar entry for 活动投稿审核"
```

---

### Task 8: Full verification + PR

**Files:** none (verification + ship)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all suites pass, including the 3 new ones (`cap-enforcement`, `approve/route`, `reject/route`).

- [ ] **Step 2: Type-check + build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: both succeed.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors in the created files.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/slice-c-marketplace-approval
gh pr create --repo BIBOYANG425/bia-admin --base main \
  --title "feat: Slice C — marketplace event-submission approval queue + weekly cap" \
  --body "Adds the officer-facing approval queue for student-submitted community events.

- Reuses the existing event_submissions table (george already enqueues 'pending' rows); migration adds decided_by/decided_at/reject_reason.
- Approve promotes the submission into events (source=community, status=active) and links approved_event_id; reject records a reason.
- 20-approvals/week marketplace cap; over-cap approvals return 429 and the UI disables the approve button.
- editor+ gated, every decision audited (event_submission.approve/reject).

Squad 30/week cap is out of scope (Slice D)."
```

- [ ] **Step 5: Verify CI is green**

After the PR opens, check `gh pr checks` and fix any failures.

---

## Acceptance criteria

- An `editor`+ officer sees pending submissions at `/admin/marketplace`, can approve (a live event appears in `/admin/events`) and reject (with a reason).
- Approving a non-pending submission returns 409; a missing one returns 404.
- The 20th approval in a 7-day window is the last allowed; the 21st returns 429 and the UI disables the approve button with the cap banner shown.
- Every approve/reject writes an `admin_audit_log` row (`event_submission.approve` / `.reject`).
- `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm build` all pass.

## Out of scope (do not build here)

- Squad 30-matches/week cap and squad matching UI — that is **Slice D**.
- Changing george's `submit_event` tool — it already enqueues to `event_submissions`. (A later enhancement could add `category` to the tool's input; not required for this slice.)
- `bia-shared` type/version changes — all new types are local to bia-admin.
- RLS policy changes — `event_submissions` is service-role-only (george writes, admin reads); no anon read path is added.
