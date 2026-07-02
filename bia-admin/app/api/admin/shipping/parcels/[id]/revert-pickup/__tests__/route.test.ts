import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, rpcMock, writeAuditMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  rpcMock: vi.fn(),
  writeAuditMock: vi.fn(),
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

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: writeAuditMock }));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({ rpc: rpcMock }),
}));

import { POST } from "../route";

const superAdmin = {
  user: { id: "admin-sa", email: "root@uscbia.com" },
  role: "super_admin" as const,
  adminUser: { id: "admin-sa", email: "root@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new Request(
    "http://localhost/api/admin/shipping/parcels/p1/revert-pickup",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/admin/shipping/parcels/[id]/revert-pickup", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    rpcMock.mockReset();
    writeAuditMock.mockReset();
    requireRoleMock.mockResolvedValue(superAdmin);
  });

  it("400s a missing / too-short reason", async () => {
    let res = await POST(req({}), ctxFor("p1"));
    expect(res.status).toBe(400);
    res = await POST(req({ reason: "x" }), ctxFor("p1"));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reverts via admin_revert_pickup and audits the reason (D3)", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "p1", status: "arrived_us" },
      error: null,
    });
    const res = await POST(req({ reason: "扫错学生的包裹" }), ctxFor("p1"));
    expect(res.status).toBe(200);
    expect((await res.json()).parcel.status).toBe("arrived_us");
    expect(rpcMock).toHaveBeenCalledWith("admin_revert_pickup", {
      p_parcel_id: "p1",
      p_reason: "扫错学生的包裹",
      p_actor_user_id: "admin-sa",
    });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "parcel.pickup_revert",
        entity_id: "p1",
        payload: { reason: "扫错学生的包裹" },
      }),
    );
  });

  it("maps RPC guard tokens to 404 / 409", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not_found" } });
    let res = await POST(req({ reason: "扫错了" }), ctxFor("p1"));
    expect(res.status).toBe(404);

    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "not_picked_up" },
    });
    res = await POST(req({ reason: "扫错了" }), ctxFor("p1"));
    expect(res.status).toBe(409);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
