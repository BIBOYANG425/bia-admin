import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, rpcMock, writeAuditMock } = vi.hoisted(
  () => ({
    requireRoleMock: vi.fn(),
    fromMock: vi.fn(),
    rpcMock: vi.fn(),
    writeAuditMock: vi.fn(),
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

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: writeAuditMock }));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

import { POST } from "../route";

const editor = {
  user: { id: "admin-cp", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-cp", email: "editor@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body?: unknown) {
  return new Request(
    "http://localhost/api/admin/shipping/parcels/p1/confirm-pickup",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function chain(result: unknown) {
  const obj: any = {
    eq: () => obj,
    order: () => obj,
    limit: () => obj,
    maybeSingle: () => Promise.resolve(result),
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  };
  return { select: () => obj };
}

function setup(
  parcel: Record<string, unknown> | null,
  pickedEvent: Record<string, unknown> | null = null,
) {
  fromMock.mockImplementation((table: string) => {
    if (table === "parcels") return chain({ data: parcel, error: null });
    if (table === "parcel_events") return chain({ data: pickedEvent, error: null });
    return chain({ data: null, error: null });
  });
}

const arrived = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  status: "arrived_us",
  pickup_token: "ab12cd34",
  member_id: "M001",
  amount_owed_cents: null,
  paid_at: null,
  updated_at: "2026-07-01T00:00:00Z",
  ...over,
});

describe("POST /api/admin/shipping/parcels/[id]/confirm-pickup", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
    writeAuditMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("404s a missing parcel", async () => {
    setup(null);
    const res = await POST(req(), ctxFor("p1"));
    expect(res.status).toBe(404);
  });

  it("409s already_picked_up and identifies a student self-confirm", async () => {
    setup(arrived({ status: "picked_up" }), {
      actor_role: "user",
      created_at: "2026-07-02T10:00:00Z",
    });
    const res = await POST(req(), ctxFor("p1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_picked_up");
    expect(body.message).toContain("学生在网站上自行确认");
  });

  it("holds an unpaid parcel behind requires_payment (D2)", async () => {
    setup(arrived({ amount_owed_cents: 8800 }));
    const res = await POST(req({}), ctxFor("p1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      requires_payment: true,
      amount_owed_cents: 8800,
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("force:true confirms the unpaid parcel, flags the audit", async () => {
    setup(arrived({ amount_owed_cents: 8800 }));
    rpcMock.mockResolvedValue({
      data: { id: "p1", status: "picked_up" },
      error: null,
    });
    const res = await POST(req({ force: true }), ctxFor("p1"));
    expect(res.status).toBe(200);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "parcel.pickup_confirm",
        payload: expect.objectContaining({ forced_unpaid: 8800 }),
      }),
    );
  });

  it("confirms a settled parcel using the server-side token (legacy no-body POST)", async () => {
    setup(arrived({ amount_owed_cents: 5000, paid_at: "2026-07-01T00:00:00Z" }));
    rpcMock.mockResolvedValue({
      data: { id: "p1", status: "picked_up" },
      error: null,
    });
    const res = await POST(req(), ctxFor("p1"));
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("admin_confirm_pickup_by_token", {
      p_parcel_id: "p1",
      p_token: "ab12cd34",
      p_actor_user_id: "admin-cp",
    });
  });
});
