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
  user: { id: "admin-r", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-r", email: "editor@uscbia.com" },
};

function thenable(result: unknown) {
  const t: any = {
    order: () => t,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return t;
}
function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/routes", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/shipping/routes", () => {
  // select() must serve BOTH the GET list (order → thenable) and the PATCH
  // prior-read (eq → maybeSingle).
  function setup(prior: Record<string, unknown> | null = { id: "r1" }) {
    fromMock.mockImplementation(() => ({
      select: () => {
        const t = thenable({ data: [{ id: "r1", method: "sea" }], error: null });
        t.eq = () => ({
          maybeSingle: () => Promise.resolve({ data: prior, error: null }),
        });
        return t;
      },
      update: (p: Record<string, unknown>) => {
        capturedPatch = p;
        return { eq: () => ({ select: () => ({ single: updateSingleMock }) }) };
      },
    }));
  }
  let capturedPatch: Record<string, unknown> | null = null;

  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    updateSingleMock.mockReset();
    capturedPatch = null;
    requireRoleMock.mockResolvedValue(editor);
    setup();
  });

  it("GET lists routes", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "r1", method: "sea" }]);
  });

  it("PATCH requires an id in the body (zod)", async () => {
    const res = await PATCH(patchReq({ price_per_kg_cny: 12 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("PATCH with no updatable fields returns no_fields", async () => {
    const res = await PATCH(patchReq({ id: "r1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
  });

  it("PATCH rejects NaN pricing instead of forwarding it (SR-8)", async () => {
    const res = await PATCH(
      patchReq({ id: "r1", price_per_kg_cny: "not-a-number" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("PATCH coerces numbers/null and forwards the patch", async () => {
    updateSingleMock.mockResolvedValue({
      data: { id: "r1", price_per_kg_cny: 12.5 },
      error: null,
    });

    const res = await PATCH(
      patchReq({
        id: "r1",
        price_per_kg_cny: "12.5",
        transit_days_estimate: null,
        active: false,
        cutoff_note: "",
        label: "海运专线",
      }),
    );
    expect(res.status).toBe(200);
    expect(capturedPatch).toMatchObject({
      price_per_kg_cny: 12.5, // "12.5" -> 12.5
      transit_days_estimate: null, // null preserved
      active: false, // boolean preserved
      cutoff_note: null, // "" -> null
      label: "海运专线",
    });
    // method must never be patchable
    expect(capturedPatch).not.toHaveProperty("method");
  });

  it("audits old→new values, not just field names (SR-5)", async () => {
    setup({ id: "r1", price_per_kg_cny: 10 });
    updateSingleMock.mockResolvedValue({
      data: { id: "r1", price_per_kg_cny: 12.5 },
      error: null,
    });
    const res = await PATCH(patchReq({ id: "r1", price_per_kg_cny: "12.5" }));
    expect(res.status).toBe(200);
    const { writeAudit } = await import("@/lib/admin/audit-log");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shipping_route.update",
        payload: expect.objectContaining({
          changes: { price_per_kg_cny: { from: 10, to: 12.5 } },
        }),
      }),
    );
  });
});
