import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, rpcMock, fromMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  rpcMock: vi.fn(),
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
  createBiaServiceRoleClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

// writeAudit pulls its own service-role client from the package root, so mock
// the helper directly to keep it a no-op in tests.
vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: vi.fn() }));

import { PATCH } from "../route";

const editor = {
  user: { id: "admin-9", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-9", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/parcels/p1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/shipping/parcels/[id]", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    rpcMock.mockReset();
    fromMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("rejects an unknown status enum", async () => {
    const res = await PATCH(patchReq({ status: "teleported" }), ctxFor("p1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an empty patch (no updatable fields)", async () => {
    const res = await PATCH(patchReq({}), ctxFor("p1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls admin_patch_parcel with the acting admin's id (audit chain) and returns the row", async () => {
    // transition pre-fetch: current expected → received_cn is forward (ok)
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { status: "expected" } }),
        }),
      }),
    }));
    rpcMock.mockResolvedValue({
      data: { id: "p1", status: "received_cn", weight_grams: 1500 },
      error: null,
    });

    const res = await PATCH(
      patchReq({ status: "received_cn", weight_grams: 1500 }),
      ctxFor("p1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "p1", status: "received_cn" });
    expect(rpcMock).toHaveBeenCalledWith("admin_patch_parcel", {
      p_id: "p1",
      p_actor_user_id: "admin-9",
      p_patch: { status: "received_cn", weight_grams: 1500 },
    });
  });

  it("409s on an invalid parcel transition (out of picked_up) without calling the RPC", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { status: "picked_up" } }),
        }),
      }),
    }));
    const res = await PATCH(patchReq({ status: "in_transit" }), ctxFor("p1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invalid_transition");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("404s when the RPC reports no row updated", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const res = await PATCH(patchReq({ notes: "x" }), ctxFor("missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("surfaces an RPC error as 500", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await PATCH(patchReq({ notes: "x" }), ctxFor("p1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("update_failed");
  });
});
