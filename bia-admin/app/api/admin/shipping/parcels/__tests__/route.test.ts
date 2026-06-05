import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, rangeMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
  rangeMock: vi.fn(),
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
  user: { id: "v2", email: "viewer@uscbia.com" },
  role: "viewer" as const,
  adminUser: { id: "v2", email: "viewer@uscbia.com" },
};

function getReq(qs = "") {
  return new Request(`http://localhost/api/admin/shipping/parcels${qs}`);
}

describe("GET /api/admin/shipping/parcels", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rangeMock.mockReset();
    requireRoleMock.mockResolvedValue(viewer);
    rangeMock.mockResolvedValue({
      data: [{ id: "p1" }],
      count: 7,
      error: null,
    });
    const builder: any = {
      order: () => builder,
      eq: () => builder,
      is: () => builder,
      or: () => builder,
      range: rangeMock,
    };
    fromMock.mockImplementation(() => ({ select: () => builder }));
  });

  it("rejects an invalid status filter", async () => {
    const res = await GET(getReq("?status=teleported"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
    expect(rangeMock).not.toHaveBeenCalled();
  });

  it("lists with default pagination (limit 50, offset 0)", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      parcels: [{ id: "p1" }],
      total: 7,
      limit: 50,
      offset: 0,
    });
    expect(rangeMock).toHaveBeenCalledWith(0, 49);
  });

  it("applies offset/limit to the range window", async () => {
    const res = await GET(getReq("?limit=10&offset=20"));
    const body = await res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(20);
    expect(rangeMock).toHaveBeenCalledWith(20, 29);
  });

  it("clamps limit to 200", async () => {
    const res = await GET(getReq("?limit=500"));
    const body = await res.json();
    expect(body.limit).toBe(200);
    expect(rangeMock).toHaveBeenCalledWith(0, 199);
  });
});
