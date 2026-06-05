import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, listUsersMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
  listUsersMock: vi.fn(),
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
  createBiaServiceRoleClient: () => ({
    from: fromMock,
    auth: { admin: { listUsers: listUsersMock } },
  }),
}));

import { GET } from "../route";

const viewer = {
  user: { id: "v3", email: "viewer@uscbia.com" },
  role: "viewer" as const,
  adminUser: { id: "v3", email: "viewer@uscbia.com" },
};

// students query chain: select().order().[or()].range() -> result
function studentsThenable(result: unknown) {
  const t: any = {
    order: () => t,
    or: () => t,
    range: () => Promise.resolve(result),
  };
  return t;
}
function getReq(qs = "") {
  return new Request(`http://localhost/api/admin/users${qs}`);
}

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    listUsersMock.mockReset();
    requireRoleMock.mockResolvedValue(viewer);
    fromMock.mockImplementation(() => ({
      select: () =>
        studentsThenable({
          data: [
            {
              id: "s1",
              name: "Alice",
              member_id: "BIA-000001",
              user_id: "u1",
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
          count: 1,
          error: null,
        }),
    }));
    listUsersMock.mockResolvedValue({
      data: { users: [{ id: "u1", email: "alice@uscbia.com" }] },
      error: null,
    });
  });

  it("lists students with joined email + total", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.students[0]).toMatchObject({
      id: "s1",
      member_id: "BIA-000001",
      email: "alice@uscbia.com",
    });
  });

  it("returns 500 with list_failed on a db error", async () => {
    fromMock.mockImplementation(() => ({
      select: () =>
        studentsThenable({ data: null, count: null, error: { message: "boom" } }),
    }));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("list_failed");
  });
});
