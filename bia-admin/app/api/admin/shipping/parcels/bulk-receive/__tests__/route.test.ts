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
  user: { id: "admin-br", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-br", email: "editor@uscbia.com" },
};

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/shipping/parcels/bulk-receive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/shipping/parcels/bulk-receive", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
    writeAuditMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
  });

  it("rejects a non-uuid id and an empty items list", async () => {
    let res = await POST(req({ items: [] }));
    expect(res.status).toBe(400);
    res = await POST(req({ items: [{ id: "not-a-uuid" }] }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("receives the batch in ONE admin_bulk_receive call and returns the id sets", async () => {
    rpcMock.mockResolvedValue({
      data: { updated: 2, updated_ids: [P1, P2], skipped_ids: [P3] },
      error: null,
    });
    const res = await POST(
      req({
        items: [
          { id: P1, weight_grams: 1200 },
          { id: P2 },
          { id: P3 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      updated: 2,
      skipped: 1,
      failed: 0,
      total: 3,
      updated_ids: [P1, P2],
      skipped_ids: [P3],
      failed_ids: [],
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("admin_bulk_receive", {
      p_items: [{ id: P1, weight_grams: 1200 }, { id: P2 }, { id: P3 }],
      p_actor_user_id: "admin-br",
    });
  });

  it("audits the exact id sets so a partial outcome is reconstructable (SR-3)", async () => {
    rpcMock.mockResolvedValue({
      data: { updated: 1, updated_ids: [P1], skipped_ids: [P2] },
      error: null,
    });
    const res = await POST(req({ items: [{ id: P1 }, { id: P2 }] }));
    expect(res.status).toBe(200);
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "parcel.bulk_receive",
        entity_type: "parcel",
        payload: expect.objectContaining({
          updated: 1,
          skipped: 1,
          updated_ids: [P1],
          skipped_ids: [P2],
          failed_ids: [],
        }),
      }),
    );
  });

  it("surfaces a non-missing-function RPC error as 500 without auditing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await POST(req({ items: [{ id: P1 }] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("receive_failed");
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("falls back to the per-parcel loop while migration 20260703000002 is unapplied", async () => {
    // First call: admin_bulk_receive missing (PGRST202). Then the legacy loop
    // reads live statuses and PATCHes the one 'expected' parcel.
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "admin_bulk_receive") {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      }
      return { data: { id: P1 }, error: null };
    });
    fromMock.mockImplementation(() => ({
      select: () => ({
        in: () =>
          Promise.resolve({
            data: [
              { id: P1, status: "expected" },
              { id: P2, status: "received_cn" },
            ],
          }),
      }),
    }));
    const res = await POST(req({ items: [{ id: P1 }, { id: P2 }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      updated: 1,
      skipped: 1,
      failed: 0,
      updated_ids: [P1],
      skipped_ids: [P2],
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "admin_patch_parcel",
      expect.objectContaining({ p_id: P1 }),
    );
  });
});
