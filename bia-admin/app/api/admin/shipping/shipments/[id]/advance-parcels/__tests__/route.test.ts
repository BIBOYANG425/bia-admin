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

function setup(
  parcelRows: Array<{ id: string; status: string }>,
  shipmentExists = true,
) {
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
    if (table === "parcels") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: parcelRows, error: null }),
        }),
      };
    }
    return {};
  });
  rpcMock.mockResolvedValue({ data: null, error: null });
}

describe("/api/admin/shipping/shipments/[id]/advance-parcels", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("rejects an invalid target status before touching anything", async () => {
    setup([]);
    const res = await POST(req({ status: "bogus" }), ctxFor("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    setup([]);
    const res = await POST(req({ nope: 1 }), ctxFor("s1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("404s when the shipment does not exist", async () => {
    setup([], false);
    const res = await POST(req({ status: "in_transit" }), ctxFor("s1"));
    expect(res.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("forward-only: advances earlier parcels, skips at/past target and branch statuses", async () => {
    setup([
      { id: "p1", status: "received_cn" }, // earlier than in_transit -> advance
      { id: "p2", status: "in_transit" }, // already at target -> skip
      { id: "p3", status: "arrived_us" }, // past target -> skip
      { id: "p4", status: "lost" }, // off-path branch -> skip
      { id: "p5", status: "expected" }, // earliest -> advance
    ]);

    const res = await POST(req({ status: "in_transit" }), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      updated: 2,
      skipped: 3,
      failed: 0,
      total: 5,
    });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenCalledWith("admin_patch_parcel", {
      p_id: "p1",
      p_actor_user_id: "admin-1",
      p_patch: { status: "in_transit" },
    });
    expect(rpcMock).toHaveBeenCalledWith("admin_patch_parcel", {
      p_id: "p5",
      p_actor_user_id: "admin-1",
      p_patch: { status: "in_transit" },
    });
  });

  it("counts per-parcel RPC failures without aborting the batch", async () => {
    setup([
      { id: "p1", status: "received_cn" },
      { id: "p2", status: "expected" },
    ]);
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(req({ status: "in_transit" }), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      updated: 1,
      failed: 1,
      total: 2,
    });
  });

  it("returns 403 when the role gate rejects", async () => {
    const { RoleError } = await import("@/lib/auth/require-role");
    requireRoleMock.mockRejectedValue(new RoleError(403, "role_required: editor"));
    const res = await POST(req({ status: "in_transit" }), ctxFor("s1"));
    expect(res.status).toBe(403);
  });
});
