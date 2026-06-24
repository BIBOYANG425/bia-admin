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
  user: { id: "admin-c", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-c", email: "editor@uscbia.com" },
};

function thenable(result: unknown) {
  const t: any = {
    order: () => t,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return t;
}
function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/contacts", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/shipping/contacts", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    updateSingleMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
    fromMock.mockImplementation(() => ({
      select: () =>
        thenable({ data: [{ id: "c1", type: "wechat_group" }], error: null }),
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingleMock }) }),
      }),
    }));
  });

  it("GET lists contacts", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "c1", type: "wechat_group" }]);
  });

  it("PATCH requires an id", async () => {
    const res = await PATCH(patchReq({ value: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "id_required" });
  });

  it("PATCH with no updatable fields returns no_fields", async () => {
    const res = await PATCH(patchReq({ id: "c1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
  });

  it("PATCH forwards value/label_en/active/display_order with empty->null", async () => {
    let captured: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      update: (p: Record<string, unknown>) => {
        captured = p;
        return { eq: () => ({ select: () => ({ single: updateSingleMock }) }) };
      },
    }));
    updateSingleMock.mockResolvedValue({ data: { id: "c1" }, error: null });

    const res = await PATCH(
      patchReq({
        id: "c1",
        value: "bia_wechat",
        label_en: "",
        active: false,
        display_order: 3,
      }),
    );
    expect(res.status).toBe(200);
    expect(captured).toMatchObject({
      value: "bia_wechat",
      label_en: null, // "" -> null
      active: false,
      display_order: 3,
    });
  });
});
