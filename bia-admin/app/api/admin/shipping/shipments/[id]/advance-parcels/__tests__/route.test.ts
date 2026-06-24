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
  user: { id: "admin-1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-1", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(body: unknown) {
  return new Request(
    "http://localhost/api/admin/shipping/shipments/s1/advance-parcels",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// The route now validates the shipment exists (via fromMock) then advances the
// whole flight atomically through admin_advance_parcels, which applies the
// skip rules in SQL and returns { total, updated, skipped }.
function setup({
  shipmentExists = true,
  rpc = { total: 5, updated: 2, skipped: 3 } as Record<string, unknown>,
} = {}) {
  fromMock.mockImplementation((table: string) => {
    if (table === "shipments") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: shipmentExists ? { id: "s1" } : null,
                error: null,
              }),
          }),
        }),
      };
    }
    return {};
  });
  rpcMock.mockResolvedValue({ data: rpc, error: null });
}

describe("/api/admin/shipping/shipments/[id]/advance-parcels", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("rejects an invalid target status before touching anything", async () => {
    setup();
    const res = await POST(req({ status: "bogus" }), ctxFor("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    setup();
    const res = await POST(req({ nope: 1 }), ctxFor("s1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("404s when the shipment does not exist (no RPC)", async () => {
    setup({ shipmentExists: false });
    const res = await POST(req({ status: "in_transit" }), ctxFor("s1"));
    expect(res.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("advances the flight atomically via one RPC and returns the counts", async () => {
    setup({ rpc: { total: 5, updated: 2, skipped: 3 } });
    const res = await POST(req({ status: "in_transit" }), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      updated: 2,
      skipped: 3,
      failed: 0,
      total: 5,
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("admin_advance_parcels", {
      p_shipment_id: "s1",
      p_target: "in_transit",
      p_only_forward: true, // default
      p_actor_user_id: "admin-1",
    });
  });

  it("forwards only_forward:false to the RPC", async () => {
    setup();
    await POST(req({ status: "in_transit", only_forward: false }), ctxFor("s1"));
    expect(rpcMock).toHaveBeenCalledWith("admin_advance_parcels", {
      p_shipment_id: "s1",
      p_target: "in_transit",
      p_only_forward: false,
      p_actor_user_id: "admin-1",
    });
  });

  it("surfaces an RPC failure as 500 (whole batch rolled back)", async () => {
    setup();
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(req({ status: "in_transit" }), ctxFor("s1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("advance_failed");
  });

  it("returns 403 when the role gate rejects", async () => {
    const { RoleError } = await import("@/lib/auth/require-role");
    requireRoleMock.mockRejectedValue(new RoleError(403, "role_required: editor"));
    const res = await POST(req({ status: "in_transit" }), ctxFor("s1"));
    expect(res.status).toBe(403);
  });
});
