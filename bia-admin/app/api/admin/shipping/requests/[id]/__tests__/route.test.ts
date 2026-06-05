import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, updateSingleMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
  updateSingleMock: vi.fn(),
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

import { PATCH } from "../route";

const editor = {
  user: { id: "admin-rq", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-rq", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/requests/rq1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/shipping/requests/[id]", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    updateSingleMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
    updateSingleMock.mockResolvedValue({
      data: { id: "rq1", status: "scheduled" },
      error: null,
    });
    fromMock.mockImplementation(() => ({
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingleMock }) }),
      }),
    }));
  });

  it("rejects an invalid status", async () => {
    const res = await PATCH(patchReq({ status: "nope" }), ctxFor("rq1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
  });

  it("returns no_fields for an empty patch", async () => {
    const res = await PATCH(patchReq({}), ctxFor("rq1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
  });

  it("updates status + admin_note and returns the row", async () => {
    let captured: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      update: (p: Record<string, unknown>) => {
        captured = p;
        return { eq: () => ({ select: () => ({ single: updateSingleMock }) }) };
      },
    }));
    const res = await PATCH(
      patchReq({ status: "scheduled", admin_note: "  排周五  " }),
      ctxFor("rq1"),
    );
    expect(res.status).toBe(200);
    expect(captured).toEqual({ status: "scheduled", admin_note: "排周五" });
  });
});
