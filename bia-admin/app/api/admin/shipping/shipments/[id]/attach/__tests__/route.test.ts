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

import { POST } from "../route";

const editor = {
  user: { id: "admin-7", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-7", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/shipments/s1/attach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function shipmentExists(exists: boolean, status = "forming") {
  fromMock.mockImplementation((table: string) => {
    if (table === "shipments") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: exists ? { id: "s1", status } : null,
                error: null,
              }),
          }),
        }),
      };
    }
    return {};
  });
}

describe("POST /api/admin/shipping/shipments/[id]/attach", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("rejects an empty parcel_ids list", async () => {
    shipmentExists(true);
    const res = await POST(req({ parcel_ids: [] }), ctxFor("s1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("404s when the shipment is missing (before calling the RPC)", async () => {
    shipmentExists(false);
    const res = await POST(req({ parcel_ids: ["p1"] }), ctxFor("s1"));
    expect(res.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("attaches via the RPC with the acting admin id and returns the count", async () => {
    shipmentExists(true);
    rpcMock.mockResolvedValue({ data: 2, error: null });
    const res = await POST(req({ parcel_ids: ["p1", "p2"] }), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2, skipped: 0 });
    expect(rpcMock).toHaveBeenCalledWith("admin_attach_parcels_to_shipment", {
      p_parcel_ids: ["p1", "p2"],
      p_shipment_id: "s1",
      p_actor_user_id: "admin-7",
    });
  });

  it("reports parcels the RPC skipped as ineligible (not received_cn)", async () => {
    shipmentExists(true);
    rpcMock.mockResolvedValue({ data: 1, error: null }); // 1 of 2 eligible
    const res = await POST(req({ parcel_ids: ["p1", "p2"] }), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1, skipped: 1 });
  });

  it("409s when the shipment has already left forming/sealed (no RPC)", async () => {
    shipmentExists(true, "archived");
    const res = await POST(req({ parcel_ids: ["p1"] }), ctxFor("s1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("shipment_not_attachable");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces an RPC failure as 500", async () => {
    shipmentExists(true);
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(req({ parcel_ids: ["p1"] }), ctxFor("s1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("attach_failed");
  });
});
