import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, rpcMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
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
  createBiaServiceRoleClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

// writeAudit pulls its own service-role client from the package root, so mock
// the helper directly to keep it a no-op in tests.
vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: vi.fn() }));

import { DELETE, PATCH } from "../route";

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
  rpcMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
});

describe("DELETE /api/admin/events/[id]", () => {
  it("uses the atomic delete+audit RPC", async () => {
    requireRoleMock.mockResolvedValue({ ...editor, role: "super_admin" });
    rpcMock.mockResolvedValue({ data: true, error: null });

    const res = await DELETE(req("DELETE"), ctxFor("e1"));

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("admin_delete_event_atomic", {
      p_admin_email: "editor@uscbia.com",
      p_event_id: "e1",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the atomic RPC deletes no event", async () => {
    requireRoleMock.mockResolvedValue({ ...editor, role: "super_admin" });
    rpcMock.mockResolvedValue({ data: false, error: null });

    const res = await DELETE(req("DELETE"), ctxFor("missing"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
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
