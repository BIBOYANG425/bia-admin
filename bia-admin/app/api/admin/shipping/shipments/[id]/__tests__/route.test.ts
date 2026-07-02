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

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: vi.fn() }));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({ from: fromMock }),
}));

import { GET, PATCH } from "../route";

const editor = {
  user: { id: "admin-sd", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-sd", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/shipments/s1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupGet(shipment: Record<string, unknown> | null, parcels: unknown[]) {
  fromMock.mockImplementation((table: string) => {
    if (table === "shipments") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: shipment, error: null }),
          }),
        }),
      };
    }
    if (table === "parcels") {
      return {
        select: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: parcels }) }),
        }),
      };
    }
    return {};
  });
}

describe("/api/admin/shipping/shipments/[id]", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    updateSingleMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("GET returns the shipment + its attached parcels", async () => {
    setupGet({ id: "s1", name: "Batch A" }, [{ id: "p1" }, { id: "p2" }]);
    const res = await GET(new Request("http://localhost/x"), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      shipment: { id: "s1", name: "Batch A" },
      parcels: [{ id: "p1" }, { id: "p2" }],
    });
  });

  it("GET 404s when the shipment is missing", async () => {
    setupGet(null, []);
    const res = await GET(new Request("http://localhost/x"), ctxFor("s1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("PATCH rejects an invalid status", async () => {
    fromMock.mockImplementation(() => ({
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingleMock }) }),
      }),
    }));
    const res = await PATCH(patchReq({ status: "nope" }), ctxFor("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
  });

  it("PATCH normalizes empty strings to null and updates", async () => {
    let captured: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      // transition pre-fetch: current status forming → departed_cn is forward (ok)
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { status: "forming" } }),
        }),
      }),
      update: (p: Record<string, unknown>) => {
        captured = p;
        return { eq: () => ({ select: () => ({ single: updateSingleMock }) }) };
      },
    }));
    updateSingleMock.mockResolvedValue({
      data: { id: "s1", status: "departed_cn" },
      error: null,
    });

    const res = await PATCH(
      patchReq({ status: "departed_cn", carrier: "", international_tracking: "SF123" }),
      ctxFor("s1"),
    );
    expect(res.status).toBe(200);
    expect(captured).toMatchObject({
      status: "departed_cn",
      carrier: null, // "" -> null
      international_tracking: "SF123",
    });
  });

  it("409s on an invalid status transition (leaving a terminal state)", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { status: "archived" } }),
        }),
      }),
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingleMock }) }),
      }),
    }));
    const res = await PATCH(patchReq({ status: "forming" }), ctxFor("s1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invalid_transition");
  });

  it("409s archiving a shipment that still has active parcels (SR-1)", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "shipments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { status: "pickup_closed" } }),
            }),
          }),
          update: () => ({
            eq: () => ({ select: () => ({ single: updateSingleMock }) }),
          }),
        };
      }
      // parcels count query: 2 parcels not yet picked_up/lost/returned
      return {
        select: () => ({
          eq: () => ({
            not: () => Promise.resolve({ count: 2, error: null }),
          }),
        }),
      };
    });
    const res = await PATCH(patchReq({ status: "archived" }), ctxFor("s1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("shipment_has_active_parcels");
    expect(updateSingleMock).not.toHaveBeenCalled();
  });

  it("archives once every attached parcel is settled", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "shipments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { status: "pickup_closed" } }),
            }),
          }),
          update: () => ({
            eq: () => ({ select: () => ({ single: updateSingleMock }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            not: () => Promise.resolve({ count: 0, error: null }),
          }),
        }),
      };
    });
    updateSingleMock.mockResolvedValue({
      data: { id: "s1", status: "archived" },
      error: null,
    });
    const res = await PATCH(patchReq({ status: "archived" }), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("archived");
  });

  it("PATCH with no fields returns no_fields", async () => {
    fromMock.mockImplementation(() => ({
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingleMock }) }),
      }),
    }));
    const res = await PATCH(patchReq({}), ctxFor("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
  });
});
