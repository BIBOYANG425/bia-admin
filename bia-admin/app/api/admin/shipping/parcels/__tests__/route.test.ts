import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, rangeMock, insertSingleMock, rpcMock } = vi.hoisted(
  () => ({
    requireRoleMock: vi.fn(),
    fromMock: vi.fn(),
    rangeMock: vi.fn(),
    insertSingleMock: vi.fn(),
    rpcMock: vi.fn(),
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

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: vi.fn() }));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

import { writeAudit } from "@/lib/admin/audit-log";
import { GET, POST } from "../route";

const viewer = {
  user: { id: "v2", email: "viewer@uscbia.com" },
  role: "viewer" as const,
  adminUser: { id: "v2", email: "viewer@uscbia.com" },
};

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};

function getReq(qs = "") {
  return new Request(`http://localhost/api/admin/shipping/parcels${qs}`);
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/parcels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/shipping/parcels", () => {
  const orCalls: string[] = [];

  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rangeMock.mockReset();
    orCalls.length = 0;
    requireRoleMock.mockResolvedValue(viewer);
    rangeMock.mockResolvedValue({
      data: [{ id: "p1" }],
      count: 7,
      error: null,
    });
    const builder: any = {
      order: () => builder,
      eq: () => builder,
      is: () => builder,
      or: (arg: string) => {
        orCalls.push(arg);
        return builder;
      },
      range: rangeMock,
    };
    fromMock.mockImplementation(() => ({ select: () => builder }));
  });

  it("rejects an invalid status filter", async () => {
    const res = await GET(getReq("?status=teleported"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
    expect(rangeMock).not.toHaveBeenCalled();
  });

  it("lists with default pagination (limit 50, offset 0)", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      parcels: [{ id: "p1" }],
      total: 7,
      limit: 50,
      offset: 0,
    });
    expect(rangeMock).toHaveBeenCalledWith(0, 49);
  });

  it("applies offset/limit to the range window", async () => {
    const res = await GET(getReq("?limit=10&offset=20"));
    const body = await res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(20);
    expect(rangeMock).toHaveBeenCalledWith(20, 29);
  });

  it("passes SANITIZED search terms into the PostgREST .or() filter (SR-4)", async () => {
    // sanitizeSearchTerm strips , ( ) * " — proves the route actually calls
    // it, not just that the pure function works in isolation.
    const res = await GET(getReq(`?search=${encodeURIComponent('ab,c(d)*e"f')}`));
    expect(res.status).toBe(200);
    expect(orCalls).toHaveLength(1);
    expect(orCalls[0]).toContain("abcdef");
    expect(orCalls[0]).toBe(
      "description.ilike.%abcdef%,tracking_cn.ilike.%abcdef%,member_id.ilike.%abcdef%",
    );
  });

  it("clamps limit to 200", async () => {
    const res = await GET(getReq("?limit=500"));
    const body = await res.json();
    expect(body.limit).toBe(200);
    expect(rangeMock).toHaveBeenCalledWith(0, 199);
  });
});

describe("POST /api/admin/shipping/parcels", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    insertSingleMock.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { id: "new-1" }, error: null });
    requireRoleMock.mockResolvedValue(editor);
    insertSingleMock.mockResolvedValue({ data: { id: "new-1" }, error: null });
    fromMock.mockImplementation(() => ({
      insert: () => ({ select: () => ({ single: insertSingleMock }) }),
    }));
  });

  it("rejects a body missing member_id", async () => {
    vi.mocked(writeAudit).mockClear();
    const res = await POST(postReq({ description: "衣服一箱" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(insertSingleMock).not.toHaveBeenCalled();
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range status (not expected/received_cn)", async () => {
    const res = await POST(
      postReq({ member_id: "BIA-1", description: "x", status: "picked_up" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(insertSingleMock).not.toHaveBeenCalled();
  });

  it("creates an expected parcel without received_at", async () => {
    const res = await POST(
      postReq({ member_id: "BIA-1", description: "衣服一箱" }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "new-1" });
    expect(rpcMock).toHaveBeenCalledWith(
      "admin_create_parcel_atomic",
      expect.objectContaining({
        p_parcel: expect.objectContaining({
          member_id: "BIA-1",
          description: "衣服一箱",
          status: "expected",
        }),
      }),
    );
    const parcel = rpcMock.mock.calls[0]![1].p_parcel;
    expect(parcel).not.toHaveProperty("received_at");
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled();
  });

  it("stamps received_at when status is received_cn", async () => {
    const res = await POST(
      postReq({
        member_id: "BIA-2",
        description: "电子产品",
        status: "received_cn",
        tracking_cn: "SF123",
        weight_grams: 1500,
      }),
    );
    expect(res.status).toBe(201);
    expect(rpcMock.mock.calls[0]![1].p_parcel).toMatchObject({
      member_id: "BIA-2",
      status: "received_cn",
      tracking_cn: "SF123",
      weight_grams: 1500,
    });
    expect(typeof rpcMock.mock.calls[0]![1].p_parcel.received_at).toBe("string");
  });

  it("seeds the timeline with a parcel_events row on create (SR-5)", async () => {
    const res = await POST(
      postReq({ member_id: "BIA-1", description: "衣服一箱" }),
    );
    expect(res.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith(
      "admin_create_parcel_atomic",
      expect.any(Object),
    );
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("creates the parcel, timeline, and audit in one RPC", async () => {
    rpcMock.mockResolvedValue({ data: { id: "new-1", status: "expected" }, error: null });

    const res = await POST(
      postReq({ member_id: "BIA-1", description: "衣服一箱" }),
    );

    expect(res.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith("admin_create_parcel_atomic", {
      p_actor_user_id: "e1",
      p_admin_email: "editor@uscbia.com",
      p_parcel: expect.objectContaining({
        member_id: "BIA-1",
        description: "衣服一箱",
        status: "expected",
      }),
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("surfaces a DB insert error as create_failed", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const res = await POST(
      postReq({ member_id: "BIA-3", description: "x" }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("create_failed");
  });
});
