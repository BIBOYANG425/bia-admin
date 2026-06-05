import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
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

import { GET } from "../route";

const viewer = {
  user: { id: "v1", email: "viewer@uscbia.com" },
  role: "viewer" as const,
  adminUser: { id: "v1", email: "viewer@uscbia.com" },
};

function listThenable(result: unknown) {
  const t: any = {
    order: () => t,
    eq: () => t,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return t;
}
function getReq(qs = "") {
  return new Request(`http://localhost/api/admin/shipping/pack-requests${qs}`);
}

function setup({
  requests,
  links,
  parcels,
}: {
  requests: Array<Record<string, unknown>>;
  links?: Array<{ request_id: string; parcel_id: string }>;
  parcels?: Array<Record<string, unknown>>;
}) {
  fromMock.mockImplementation((table: string) => {
    if (table === "pack_requests") {
      return { select: () => listThenable({ data: requests, error: null }) };
    }
    if (table === "pack_request_parcels") {
      return {
        select: () => ({ in: () => Promise.resolve({ data: links ?? [] }) }),
      };
    }
    if (table === "parcels") {
      return {
        select: () => ({ in: () => Promise.resolve({ data: parcels ?? [] }) }),
      };
    }
    return {};
  });
}

describe("GET /api/admin/shipping/pack-requests", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    requireRoleMock.mockResolvedValue(viewer);
  });

  it("rejects an invalid status filter", async () => {
    setup({ requests: [] });
    const res = await GET(getReq("?status=bogus"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_status" });
  });

  it("returns [] when there are no pack requests", async () => {
    setup({ requests: [] });
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("joins each request to its parcels", async () => {
    setup({
      requests: [
        { id: "pr1", status: "pending" },
        { id: "pr2", status: "contacted" },
      ],
      links: [
        { request_id: "pr1", parcel_id: "p1" },
        { request_id: "pr1", parcel_id: "p2" },
        { request_id: "pr2", parcel_id: "p3" },
      ],
      parcels: [
        { id: "p1", member_id: "BIA-1" },
        { id: "p2", member_id: "BIA-2" },
        { id: "p3", member_id: "BIA-3" },
      ],
    });

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      parcels: Array<{ id: string }>;
    }>;
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe("pr1");
    expect(body[0].parcels.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(body[1].id).toBe("pr2");
    expect(body[1].parcels.map((p) => p.id)).toEqual(["p3"]);
  });
});
