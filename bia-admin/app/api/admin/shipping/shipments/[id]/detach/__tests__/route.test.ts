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

const editor = {
  user: { id: "admin-dt", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-dt", email: "editor@uscbia.com" },
};

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/shipments/s1/detach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/shipping/shipments/[id]/detach", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    rpcMock.mockReset();
    writeAuditMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("rejects an empty / non-uuid parcel list", async () => {
    let res = await POST(req({ parcel_ids: [] }), ctxFor("s1"));
    expect(res.status).toBe(400);
    res = await POST(req({ parcel_ids: ["nope"] }), ctxFor("s1"));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("detaches via the RPC and audits the exact parcel ids (SR-7)", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    const res = await POST(req({ parcel_ids: [P1, P2] }), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1, skipped: 1 });
    expect(rpcMock).toHaveBeenCalledWith("admin_detach_parcels_from_shipment", {
      p_parcel_ids: [P1, P2],
      p_shipment_id: "s1",
      p_actor_user_id: "admin-dt",
    });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shipment.detach",
        entity_id: "s1",
        payload: expect.objectContaining({
          parcel_ids: [P1, P2],
          updated: 1,
          skipped: 1,
        }),
      }),
    );
  });

  it("maps the RPC's in-txn shipment re-check to 409", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "shipment_not_detachable: departed_cn" },
    });
    const res = await POST(req({ parcel_ids: [P1] }), ctxFor("s1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("shipment_not_detachable");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
