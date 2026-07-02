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

import { writeAudit } from "@/lib/admin/audit-log";
import { PATCH } from "../route";

const editor = {
  user: { id: "admin-pk", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-pk", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/pack-requests/pr1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/shipping/pack-requests/[id]", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    updateSingleMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
    updateSingleMock.mockResolvedValue({
      data: { id: "pr1", status: "contacted" },
      error: null,
    });
    fromMock.mockImplementation(() => ({
      update: () => ({
        eq: () => ({ select: () => ({ single: updateSingleMock }) }),
      }),
    }));
  });

  it("rejects an invalid status", async () => {
    const res = await PATCH(patchReq({ status: "nope" }), ctxFor("pr1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
  });

  it("returns no_fields for an empty patch", async () => {
    const res = await PATCH(patchReq({}), ctxFor("pr1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_fields" });
  });

  it("updates status/admin_note and IGNORES shipment_id (attach-only)", async () => {
    let captured: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      // transition pre-fetch: current pending → contacted is forward (ok)
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { status: "pending" } }),
        }),
      }),
      update: (p: Record<string, unknown>) => {
        captured = p;
        return { eq: () => ({ select: () => ({ single: updateSingleMock }) }) };
      },
    }));
    const res = await PATCH(
      // shipment_id is sent but must be stripped — associating a request with a
      // shipment is the /attach route's job (it also moves the parcels).
      patchReq({ status: "contacted", admin_note: "", shipment_id: "s1" }),
      ctxFor("pr1"),
    );
    expect(res.status).toBe(200);
    expect(captured).toEqual({
      status: "contacted",
      admin_note: null, // "" -> null
    });
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pack_request.update", entity_id: "pr1" }),
    );
  });
});
