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
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    updateSingleMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
    fromMock.mockImplementation(() => ({
      select: () => thenable({ data: [{ id: "r1", method: "sea" }], error: null }),
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingleMock }) }),
      }),
    }));
  });

  it("GET lists routes", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "r1", method: "sea" }]);
  });

  it("PATCH requires an id in the body", async () => {
    const res = await PATCH(patchReq({ price_per_kg_cny: 12 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "id_required" });
  });

  it("PATCH with no updatable fields returns no_fields", async () => {
    const res = await PATCH(patchReq({ id: "r1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
  });

  it("PATCH coerces numbers/null and forwards the patch", async () => {
    let captured: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      update: (p: Record<string, unknown>) => {
        captured = p;
        return { eq: () => ({ select: () => ({ single: updateSingleMock }) }) };
      },
    }));
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
    expect(captured).toMatchObject({
      price_per_kg_cny: 12.5, // "12.5" -> 12.5
      transit_days_estimate: null, // null preserved
      active: false, // boolean preserved
      cutoff_note: null, // "" -> null
      label: "海运专线",
    });
    // method must never be patchable
    expect(captured).not.toHaveProperty("method");
  });
});
