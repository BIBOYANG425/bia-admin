import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, insertSingleMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
  insertSingleMock: vi.fn(),
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
  user: { id: "admin-5", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-5", email: "editor@uscbia.com" },
};

// A supabase query builder is chainable AND awaitable (thenable).
function thenable(result: unknown) {
  const t: any = {
    order: () => t,
    eq: () => t,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return t;
}

function getReq(qs = "") {
  return new Request(`http://localhost/api/admin/shipping/shipments${qs}`);
}
function postReq(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/shipments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/shipping/shipments", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    insertSingleMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
    fromMock.mockImplementation(() => ({
      select: () => thenable({ data: [{ id: "s1" }], error: null }),
      insert: () => ({
        select: () => ({ single: insertSingleMock }),
      }),
    }));
  });

  it("GET lists shipments", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "s1" }]);
  });

  it("GET rejects an invalid status filter", async () => {
    const res = await GET(getReq("?status=bogus"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_status");
  });

  it("POST creates a shipment with created_by = acting admin and 201", async () => {
    insertSingleMock.mockResolvedValue({
      data: { id: "s9", name: "Batch A", status: "forming" },
      error: null,
    });
    const res = await POST(postReq({ name: "Batch A", carrier: "DHL" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "s9", name: "Batch A" });
  });

  it("POST rejects an empty name", async () => {
    const res = await POST(postReq({ name: "   " }));
    expect(res.status).toBe(400);
    // zod min(1) trims? name is "   " (len 3) passes zod min(1), then handler
    // trims to "" -> name_required
    expect((await res.json()).error).toBe("name_required");
  });

  it("POST rejects a missing name (zod)", async () => {
    const res = await POST(postReq({ carrier: "DHL" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });
});
