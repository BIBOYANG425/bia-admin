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

// Use the REAL rate limiter (in-memory) — reset between tests.
import { __resetRateLimitStore } from "@/lib/rate-limit";
import { POST } from "../route";

const editor = {
  user: { id: "admin-pk", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-pk", email: "editor@uscbia.com" },
};

const CODE = "ab12cd34";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/pickup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Chainable thenable — resolves to `result` however deep the chain goes. */
function chain(result: unknown) {
  const obj: any = {
    eq: () => obj,
    neq: () => obj,
    order: () => obj,
    limit: () => obj,
    maybeSingle: () => Promise.resolve(result),
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  };
  return { select: () => obj };
}

interface SetupOpts {
  /** Result rows for the token lookup (first parcels query). */
  lookup: unknown[];
  /** Result rows for the remaining-parcels query (second parcels query). */
  remaining?: unknown[];
  /** Latest picked_up parcel_events row. */
  pickedEvent?: { actor_role: string; created_at: string } | null;
}

function setup({ lookup, remaining = [], pickedEvent = null }: SetupOpts) {
  let parcelCalls = 0;
  fromMock.mockImplementation((table: string) => {
    if (table === "parcels") {
      parcelCalls += 1;
      return chain({
        data: parcelCalls === 1 ? lookup : remaining,
        error: null,
      });
    }
    if (table === "parcel_events") {
      return chain({ data: pickedEvent, error: null });
    }
    return chain({ data: null, error: null });
  });
}

const arrived = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  member_id: "M001",
  description: "冬季衣物",
  status: "arrived_us",
  amount_owed_cents: null,
  paid_at: null,
  paid_method: null,
  updated_at: "2026-07-01T00:00:00Z",
  ...over,
});

describe("POST /api/admin/shipping/pickup/verify", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
    writeAuditMock.mockReset();
    __resetRateLimitStore();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("400s an empty code", async () => {
    const res = await POST(req({ code: "" }));
    expect(res.status).toBe(400);
  });

  it("404s an unknown code and audits the failed attempt", async () => {
    setup({ lookup: [] });
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(404);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "parcel.pickup_verify_failed",
        payload: expect.objectContaining({ reason: "not_found" }),
      }),
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("409s an already-picked_up parcel and says WHO confirmed (self vs desk)", async () => {
    setup({
      lookup: [arrived({ status: "picked_up" })],
      pickedEvent: { actor_role: "user", created_at: "2026-07-02T10:00:00Z" },
    });
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_picked_up");
    expect(body.message).toContain("学生在网站上自行确认");
    expect(body.picked_up_by).toBe("user");
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "parcel.pickup_verify_failed",
        payload: expect.objectContaining({ reason: "already_picked_up" }),
      }),
    );
  });

  it("409s a not-yet-arrived parcel with its current status", async () => {
    setup({ lookup: [arrived({ status: "in_transit" })] });
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_pickup_eligible");
  });

  it("409s a multi-match with the candidate list", async () => {
    setup({
      lookup: [arrived(), arrived({ id: "p2", member_id: "M002" })],
    });
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(409);
    expect((await res.json()).matches).toEqual([
      { id: "p1", member_id: "M001" },
      { id: "p2", member_id: "M002" },
    ]);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("HOLDS an unpaid parcel (requires_payment) without confirming (D2)", async () => {
    setup({ lookup: [arrived({ amount_owed_cents: 12050 })] });
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      requires_payment: true,
      member_id: "M001",
      amount_owed_cents: 12050,
    });
    expect(rpcMock).not.toHaveBeenCalled();
    // A hold is not an outcome — nothing audited yet.
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("force:true confirms the unpaid parcel and flags it in response + audit", async () => {
    setup({ lookup: [arrived({ amount_owed_cents: 12050 })] });
    rpcMock.mockResolvedValue({
      data: { id: "p1", status: "picked_up" },
      error: null,
    });
    const res = await POST(req({ code: CODE, force: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).unpaid_confirmed).toBe(12050);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "parcel.pickup_verify",
        payload: expect.objectContaining({ forced_unpaid: 12050 }),
      }),
    );
  });

  it("confirms a paid parcel and returns the student's remaining parcels", async () => {
    setup({
      lookup: [arrived({ amount_owed_cents: 5000, paid_at: "2026-07-01T00:00:00Z" })],
      remaining: [
        { id: "p9", description: "书", amount_owed_cents: 3000, paid_at: null },
      ],
    });
    rpcMock.mockResolvedValue({
      data: { id: "p1", status: "picked_up" },
      error: null,
    });
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.member_id).toBe("M001");
    expect(body.remaining).toEqual([
      { id: "p9", description: "书", unpaid: 3000 },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("admin_confirm_pickup_by_token", {
      p_parcel_id: "p1",
      p_token: CODE,
      p_actor_user_id: "admin-pk",
    });
  });

  it("audits success with the code SUFFIX only — never the replayable full code", async () => {
    setup({ lookup: [arrived()] });
    rpcMock.mockResolvedValue({ data: { id: "p1" }, error: null });
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(200);
    const payload = writeAuditMock.mock.calls[0][0].payload as Record<
      string,
      unknown
    >;
    expect(payload.code_suffix).toBe(CODE.slice(-2));
    expect(JSON.stringify(payload)).not.toContain(CODE);
  });

  it("maps the RPC bad_token re-check to 409", async () => {
    setup({ lookup: [arrived()] });
    rpcMock.mockResolvedValue({ data: null, error: { message: "bad_token" } });
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("取件码不匹配");
  });

  it("429s the 31st attempt in a minute with Retry-After", async () => {
    setup({ lookup: [] });
    for (let i = 0; i < 30; i++) {
      await POST(req({ code: CODE }));
    }
    const res = await POST(req({ code: CODE }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
