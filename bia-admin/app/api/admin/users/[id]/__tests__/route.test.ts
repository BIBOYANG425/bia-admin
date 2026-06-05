import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, getUserByIdMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
  getUserByIdMock: vi.fn(),
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
    auth: { admin: { getUserById: getUserByIdMock } },
  }),
}));

import { GET } from "../route";

const viewer = {
  user: { id: "v3", email: "viewer@uscbia.com" },
  role: "viewer" as const,
  adminUser: { id: "v3", email: "viewer@uscbia.com" },
};

const student = {
  id: "s1",
  name: "Alice",
  member_id: "BIA-000001",
  user_id: "u1",
  major: "CS",
  year: "2026",
  created_at: "2026-01-01T00:00:00Z",
};

function studentRow(data: unknown, error: unknown = null) {
  return {
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }) }),
  };
}
function listRows(result: unknown) {
  return { select: () => ({ eq: () => ({ order: () => Promise.resolve(result) }) }) };
}
function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function getReq() {
  return new Request("http://localhost/api/admin/users/s1");
}

describe("GET /api/admin/users/[id]", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    getUserByIdMock.mockReset();
    requireRoleMock.mockResolvedValue(viewer);
    getUserByIdMock.mockResolvedValue({
      data: { user: { email: "alice@uscbia.com" } },
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "students") return studentRow(student);
      if (table === "parcels")
        return listRows({
          data: [
            { id: "p1", status: "received_cn" },
            { id: "p2", status: "received_cn" },
          ],
          error: null,
        });
      if (table === "course_reviews") return listRows({ data: [], error: null });
      return {};
    });
  });

  it("returns student + email + parcels-by-status", async () => {
    const res = await GET(getReq(), ctxFor("s1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.student.id).toBe("s1");
    expect(body.email).toBe("alice@uscbia.com");
    expect(body.parcels).toHaveLength(2);
    expect(body.parcelsByStatus).toEqual({ received_cn: 2 });
    expect(body.reviewsUnavailable).toBe(false);
  });

  it("404s when the student is missing", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "students" ? studentRow(null) : {},
    );
    const res = await GET(getReq(), ctxFor("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("flags reviews unavailable when course_reviews table is missing", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "students") return studentRow(student);
      if (table === "parcels") return listRows({ data: [], error: null });
      if (table === "course_reviews")
        return listRows({
          data: null,
          error: { message: 'relation "course_reviews" does not exist' },
        });
      return {};
    });
    const res = await GET(getReq(), ctxFor("s1"));
    const body = await res.json();
    expect(body.reviewsUnavailable).toBe(true);
    expect(body.reviews).toBeNull();
  });
});
