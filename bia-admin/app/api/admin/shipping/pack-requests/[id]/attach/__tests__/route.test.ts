import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, rpcMock, updateSingleMock } = vi.hoisted(
  () => ({
    requireRoleMock: vi.fn(),
    fromMock: vi.fn(),
    rpcMock: vi.fn(),
    updateSingleMock: vi.fn(),
  }),
);

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
  user: { id: "admin-3", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-3", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new Request(
    "http://localhost/api/admin/shipping/pack-requests/pr1/attach",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function setup({
  shipment = { id: "s1", status: "forming" } as Record<string, unknown> | null,
  pack = { id: "pr1", status: "pending" } as Record<string, unknown> | null,
  links = [{ parcel_id: "p1" }, { parcel_id: "p2" }] as Array<{
    parcel_id: string;
  }>,
} = {}) {
  fromMock.mockImplementation((table: string) => {
    if (table === "shipments") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: shipment }) }),
        }),
      };
    }
    if (table === "pack_request_parcels") {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: links }) }),
      };
    }
    if (table === "pack_requests") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: pack }) }),
        }),
        update: () => ({
          eq: () => ({ select: () => ({ single: updateSingleMock }) }),
        }),
      };
    }
    return {};
  });
  rpcMock.mockResolvedValue({ data: 2, error: null });
  updateSingleMock.mockResolvedValue({
    data: { id: "pr1", status: "approved", shipment_id: "s1" },
    error: null,
  });
}

describe("POST /api/admin/shipping/pack-requests/[id]/attach", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
    updateSingleMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("rejects a missing shipment_id", async () => {
    setup();
    const res = await POST(req({}), ctxFor("pr1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("404s when the target shipment does not exist", async () => {
    setup({ shipment: null });
    const res = await POST(req({ shipment_id: "s1" }), ctxFor("pr1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "shipment_not_found" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("404s when the pack request does not exist", async () => {
    setup({ pack: null });
    const res = await POST(req({ shipment_id: "s1" }), ctxFor("pr1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("400s when the pack request has no parcels", async () => {
    setup({ links: [] });
    const res = await POST(req({ shipment_id: "s1" }), ctxFor("pr1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_parcels" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("attaches all parcels via RPC, marks the request approved, and returns both", async () => {
    setup();
    const res = await POST(req({ shipment_id: "s1" }), ctxFor("pr1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      attached: 2,
      skipped: 0,
      request: { id: "pr1", status: "approved", shipment_id: "s1" },
    });
    expect(rpcMock).toHaveBeenCalledWith("admin_attach_parcels_to_shipment", {
      p_parcel_ids: ["p1", "p2"],
      p_shipment_id: "s1",
      p_actor_user_id: "admin-3",
    });
  });

  it("reports skipped parcels the RPC found ineligible (not received_cn)", async () => {
    setup();
    rpcMock.mockResolvedValue({ data: 1, error: null }); // 1 of 2 eligible
    const res = await POST(req({ shipment_id: "s1" }), ctxFor("pr1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ attached: 1, skipped: 1 });
  });

  it("409s when the target shipment is past forming/sealed (no RPC)", async () => {
    setup({ shipment: { id: "s1", status: "departed_cn" } });
    const res = await POST(req({ shipment_id: "s1" }), ctxFor("pr1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("shipment_not_attachable");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("409s when the pack request is no longer pending/contacted (no RPC)", async () => {
    setup({ pack: { id: "pr1", status: "approved" } });
    const res = await POST(req({ shipment_id: "s1" }), ctxFor("pr1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("request_not_attachable");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces an RPC failure as 500 and does not mark approved", async () => {
    setup();
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc boom" } });
    const res = await POST(req({ shipment_id: "s1" }), ctxFor("pr1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("attach_failed");
    expect(updateSingleMock).not.toHaveBeenCalled();
  });
});
