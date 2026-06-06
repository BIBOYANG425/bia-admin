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

import { GET, POST } from "../route";

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};

function thenable(result: unknown) {
  const t: any = {
    order: () => t,
    limit: () => t,
    eq: () => t,
    in: () => t,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return t;
}
function postReq(body: unknown) {
  return new Request("http://localhost/api/admin/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireRoleMock.mockReset();
  fromMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
});

describe("GET /api/admin/events", () => {
  it("lists events with rsvp_count", async () => {
    fromMock.mockImplementation((table: string) => ({
      select: () =>
        table === "events"
          ? thenable({
              data: [{ id: "e1", title: "Mixer", status: "active" }],
              error: null,
            })
          : thenable({ data: [{ event_id: "e1" }, { event_id: "e1" }], error: null }),
    }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ id: "e1", rsvp_count: 2 });
  });
});

describe("POST /api/admin/events", () => {
  it("rejects a body with no title", async () => {
    const res = await POST(postReq({ location: "TCC" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("creates a BIA event and returns it", async () => {
    let captured: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      insert: (row: Record<string, unknown>) => {
        captured = row;
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: "e9", ...row }, error: null }),
          }),
        };
      },
    }));
    const res = await POST(postReq({ title: "BIA Mixer", location: "TCC" }));
    expect(res.status).toBe(200);
    expect(captured).toMatchObject({ title: "BIA Mixer", source: "bia", status: "active" });
  });
});
