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
  user: { id: "admin-ra", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-ra", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new Request(
    "http://localhost/api/admin/shipping/parcels/p1/reassign",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/admin/shipping/parcels/[id]/reassign", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    rpcMock.mockReset();
    writeAuditMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("400s a missing member_id", async () => {
    const res = await POST(req({}), ctxFor("p1"));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reassigns via the RPC and audits from→to + link outcome (SR-7)", async () => {
    rpcMock.mockResolvedValue({
      data: {
        parcel: { id: "p1", member_id: "BIA-9" },
        linked: true,
        prior_member_id: "BIA-1",
      },
      error: null,
    });
    const res = await POST(req({ member_id: "BIA-9" }), ctxFor("p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      parcel: { id: "p1", member_id: "BIA-9" },
      linked: true,
      prior_member_id: "BIA-1",
    });
    expect(rpcMock).toHaveBeenCalledWith("admin_reassign_parcel_student", {
      p_parcel_id: "p1",
      p_member_id: "BIA-9",
      p_actor_user_id: "admin-ra",
    });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "parcel.reassign",
        entity_id: "p1",
        payload: {
          from_member_id: "BIA-1",
          to_member_id: "BIA-9",
          linked: true,
        },
      }),
    );
  });

  it("surfaces an unlinked reassign (no students match) as linked:false", async () => {
    rpcMock.mockResolvedValue({
      data: { parcel: { id: "p1" }, linked: false, prior_member_id: "BIA-1" },
      error: null,
    });
    const res = await POST(req({ member_id: "WALKIN-3" }), ctxFor("p1"));
    expect(res.status).toBe(200);
    expect((await res.json()).linked).toBe(false);
  });

  it("maps RPC guard tokens: picked_up → 409, missing → 404", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "parcel_terminal" },
    });
    let res = await POST(req({ member_id: "BIA-9" }), ctxFor("p1"));
    expect(res.status).toBe(409);

    rpcMock.mockResolvedValue({ data: null, error: { message: "not_found" } });
    res = await POST(req({ member_id: "BIA-9" }), ctxFor("p1"));
    expect(res.status).toBe(404);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
