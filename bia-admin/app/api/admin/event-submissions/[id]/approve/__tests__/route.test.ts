import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, rpcMock, capMock, auditMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  rpcMock: vi.fn(),
  capMock: vi.fn(),
  auditMock: vi.fn(),
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
  createBiaServiceRoleClient: () => ({ rpc: rpcMock }),
}));

vi.mock("@/lib/marketplace/cap-enforcement", () => ({
  MARKETPLACE_WEEKLY_CAP: 20,
  countApprovedSubmissionsThisWeek: capMock,
}));

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: auditMock }));

import { POST } from "../route";

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};
const SUB_ID = "11111111-1111-1111-1111-111111111111";

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req() {
  return new Request("http://localhost/api/admin/event-submissions/x/approve", {
    method: "POST",
  });
}

beforeEach(() => {
  requireRoleMock.mockReset();
  rpcMock.mockReset();
  capMock.mockReset();
  auditMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
  capMock.mockResolvedValue(0);
});

describe("POST /api/admin/event-submissions/[id]/approve", () => {
  it("approves a pending submission via the atomic RPC and links the event", async () => {
    rpcMock.mockResolvedValue({ data: "ev-9", error: null });

    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, event_id: "ev-9" });
    expect(rpcMock).toHaveBeenCalledWith("approve_event_submission", {
      p_submission_id: SUB_ID,
      p_admin_id: "e1",
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event_submission.approve",
        entity_type: "event_submission",
        entity_id: SUB_ID,
      }),
    );
  });

  it("404s when the RPC reports not_found", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not_found" } });
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("409s when the submission is not pending", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "invalid_transition:approved" },
    });
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invalid_transition");
  });

  it("429s when the weekly cap is reached (RPC not called)", async () => {
    capMock.mockResolvedValue(20);
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("cap_reached");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("403s a viewer (role gate)", async () => {
    requireRoleMock.mockRejectedValue(
      Object.assign(new Error("role_required: editor"), {
        status: 403,
        code: "role_required: editor",
      }),
    );
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(403);
  });
});
