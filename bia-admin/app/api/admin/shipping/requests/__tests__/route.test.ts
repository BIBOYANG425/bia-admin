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

import { GET } from "../route";

const viewer = {
  user: { id: "v3", email: "viewer@uscbia.com" },
  role: "viewer" as const,
  adminUser: { id: "v3", email: "viewer@uscbia.com" },
};

function listThenable(result: unknown) {
  const t: any = {
    order: () => t,
    limit: () => t,
    eq: () => t,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return t;
}
function getReq(qs = "") {
  return new Request(`http://localhost/api/admin/shipping/requests${qs}`);
}

describe("GET /api/admin/shipping/requests", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    requireRoleMock.mockResolvedValue(viewer);
    fromMock.mockImplementation(() => ({
      select: () =>
        listThenable({ data: [{ id: "rq1", status: "pending" }], error: null }),
    }));
  });

  it("lists shipment requests", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "rq1", status: "pending" }]);
  });

  it("rejects an invalid status filter", async () => {
    const res = await GET(getReq("?status=bogus"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
  });
});
