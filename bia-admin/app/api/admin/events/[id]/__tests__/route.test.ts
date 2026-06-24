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

// writeAudit pulls its own service-role client from the package root, so mock
// the helper directly to keep it a no-op in tests.
vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: vi.fn() }));

import { GET, PATCH } from "../route";

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/events/e1", {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  requireRoleMock.mockReset();
  fromMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
});

describe("GET /api/admin/events/[id]", () => {
  it("404s when the event is missing", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "events"
        ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
        : {},
    );
    const res = await GET(req("GET"), ctxFor("nope"));
    expect(res.status).toBe(404);
  });

  it("returns the event + attendance roster", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: "e1", title: "Mixer" }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  { source: "rsvp", created_at: "2026-06-01T00:00:00Z", students: { id: "s", name: "A", member_id: "BIA-1" } },
                ],
                error: null,
              }),
          }),
        }),
      };
    });
    const res = await GET(req("GET"), ctxFor("e1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.event.id).toBe("e1");
    expect(body.attendance).toHaveLength(1);
  });
});

describe("PATCH /api/admin/events/[id]", () => {
  it("rejects an invalid status", async () => {
    fromMock.mockImplementation(() => ({
      update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    }));
    const res = await PATCH(req("PATCH", { status: "nope" }), ctxFor("e1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_status");
  });

  it("returns no_fields for an empty patch", async () => {
    const res = await PATCH(req("PATCH", {}), ctxFor("e1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no_fields");
  });

  it("updates fields and returns the row", async () => {
    let captured: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      update: (p: Record<string, unknown>) => {
        captured = p;
        return {
          eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "e1", title: "New" }, error: null }) }) }),
        };
      },
    }));
    const res = await PATCH(req("PATCH", { title: "New", status: "cancelled" }), ctxFor("e1"));
    expect(res.status).toBe(200);
    expect(captured).toEqual({ title: "New", status: "cancelled" });
  });
});
