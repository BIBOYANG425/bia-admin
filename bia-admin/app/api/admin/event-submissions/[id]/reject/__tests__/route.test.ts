import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, auditMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
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
  createBiaServiceRoleClient: () => ({ from: fromMock }),
}));

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: auditMock }));

import { POST } from "../route";

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};
const SUB_ID = "22222222-2222-2222-2222-222222222222";

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body?: unknown) {
  return new Request("http://localhost/api/admin/event-submissions/x/reject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function wirePending(status = "pending") {
  let captured: any = null;
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: SUB_ID, status }, error: null }) }),
    }),
    update: (row: any) => {
      captured = row;
      return { eq: () => Promise.resolve({ error: null }) };
    },
  }));
  return () => captured;
}

beforeEach(() => {
  requireRoleMock.mockReset();
  fromMock.mockReset();
  auditMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
});

describe("POST /api/admin/event-submissions/[id]/reject", () => {
  it("rejects a pending submission with a reason and audits it", async () => {
    const captured = wirePending();
    const res = await POST(req({ reason: "off-topic" }), ctxFor(SUB_ID));
    expect(res.status).toBe(200);
    expect(captured()).toMatchObject({
      status: "rejected",
      reject_reason: "off-topic",
      decided_by: "e1",
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event_submission.reject",
        entity_type: "event_submission",
        entity_id: SUB_ID,
        payload: { reason: "off-topic" },
      }),
    );
  });

  it("rejects without a reason (reason becomes null)", async () => {
    const captured = wirePending();
    const res = await POST(req({}), ctxFor(SUB_ID));
    expect(res.status).toBe(200);
    expect(captured()).toMatchObject({ status: "rejected", reject_reason: null });
  });

  it("404s when the submission does not exist", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));
    const res = await POST(req({ reason: "x" }), ctxFor(SUB_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("409s when the submission is not pending", async () => {
    wirePending("rejected");
    const res = await POST(req({ reason: "x" }), ctxFor(SUB_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invalid_transition");
  });

  it("403s a viewer (role gate)", async () => {
    requireRoleMock.mockRejectedValue(
      Object.assign(new Error("role_required: editor"), { status: 403, code: "role_required: editor" }),
    );
    const res = await POST(req({ reason: "x" }), ctxFor(SUB_ID));
    expect(res.status).toBe(403);
  });
});
