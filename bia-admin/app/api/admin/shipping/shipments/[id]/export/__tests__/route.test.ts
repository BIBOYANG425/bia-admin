import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, writeAuditMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
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
  RoleError: class RoleError extends Error {},
}));

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: writeAuditMock }));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({ from: fromMock }),
}));

import { GET } from "../route";

const viewer = {
  user: { id: "v1", email: "viewer@uscbia.com" },
  role: "viewer" as const,
  adminUser: { id: "v1", email: "viewer@uscbia.com" },
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function setup(parcels: unknown[]) {
  fromMock.mockImplementation((table: string) => {
    if (table === "shipments") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: "s1", name: "Batch A" }, error: null }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: parcels, error: null }),
        }),
      }),
    };
  });
}

const baseParcel = {
  member_id: "M001",
  description: "衣服",
  status: "arrived_us",
  weight_grams: 1500,
  shipping_method: "sea",
  tracking_cn: "SF123",
  created_at: "2026-07-01T00:00:00Z",
  amount_owed_cents: 12050,
  paid_at: null,
  paid_method: null,
  paid_by_admin: null,
};

describe("GET /api/admin/shipping/shipments/[id]/export", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    fromMock.mockReset();
    writeAuditMock.mockReset();
    requireRoleMock.mockResolvedValue(viewer);
  });

  it("streams a UTF-8-BOM CSV and audits the export (SR-5)", async () => {
    setup([baseParcel]);
    const res = await GET(new Request("http://localhost/x"), ctxFor("s1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    // Response.text() strips the BOM — check the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('"M001"');
    expect(text).toContain('"120.50"'); // cents → ¥
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shipment.export",
        entity_id: "s1",
        payload: { rows: 1 },
      }),
    );
  });

  it("neutralizes formula injection — including behind leading whitespace (SR-8)", async () => {
    setup([
      { ...baseParcel, description: "=HYPERLINK(\"evil\")" },
      { ...baseParcel, member_id: "M002", description: " \t+SUM(A1:A9)" },
      { ...baseParcel, member_id: "M003", tracking_cn: "@cmd" },
    ]);
    const res = await GET(new Request("http://localhost/x"), ctxFor("s1"));
    const text = await res.text();
    // Every =+-@ payload gets a leading apostrophe inside its quoted cell.
    expect(text).toContain('"\'=HYPERLINK(""evil"")"');
    expect(text).toContain('"\' \t+SUM(A1:A9)"');
    expect(text).toContain('"\'@cmd"');
    // No cell begins its content with a live formula trigger.
    for (const line of text.split("\r\n").slice(1)) {
      for (const cell of line.split('","')) {
        const inner = cell.replace(/^"?/, "").replace(/"?$/, "");
        expect(inner.trimStart().startsWith("=")).toBe(false);
      }
    }
  });

  it("404s an unknown shipment without auditing", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }));
    const res = await GET(new Request("http://localhost/x"), ctxFor("nope"));
    expect(res.status).toBe(404);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
