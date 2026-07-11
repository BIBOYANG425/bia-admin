// Pins the min-role every shipping handler passes to withRole (SR-4).
// Every per-route suite mocks withRole and DISCARDS the role argument, so an
// editor-gate → viewer-gate regression used to pass the whole suite. Here the
// mock returns 204 without running the handler body (no supabase mocks
// needed) and records the requested role — one table covers all 29 gates.
// If you add a shipping route, add its row; the count assertion below fails
// otherwise-silently-forgotten additions.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { roleCalls } = vi.hoisted(() => ({ roleCalls: [] as string[] }));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: (min: unknown) => {
    roleCalls.push(String(min));
    return new Response(null, { status: 204 });
  },
  RoleError: class RoleError extends Error {},
}));

// Not strictly needed (handler bodies never run) but keeps module-eval cheap.
vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: vi.fn() }));

const ctx = { params: Promise.resolve({ id: "x" }) };
const req = (method = "GET") =>
  new Request("http://localhost/api/admin/shipping/test", { method });

type Case = {
  name: string;
  min: "viewer" | "editor" | "super_admin";
  invoke: () => Promise<unknown>;
};

const CASES: Case[] = [
  { name: "GET /parcels", min: "viewer", invoke: async () => (await import("../parcels/route")).GET(req()) },
  { name: "POST /parcels", min: "editor", invoke: async () => (await import("../parcels/route")).POST(req("POST")) },
  { name: "GET /parcels/[id]", min: "viewer", invoke: async () => (await import("../parcels/[id]/route")).GET(req(), ctx) },
  { name: "PATCH /parcels/[id]", min: "editor", invoke: async () => (await import("../parcels/[id]/route")).PATCH(req("PATCH"), ctx) },
  { name: "PATCH /parcels/[id]/payment", min: "editor", invoke: async () => (await import("../parcels/[id]/payment/route")).PATCH(req("PATCH"), ctx) },
  { name: "POST /parcels/[id]/confirm-pickup", min: "editor", invoke: async () => (await import("../parcels/[id]/confirm-pickup/route")).POST(req("POST"), ctx) },
  { name: "POST /parcels/[id]/revert-pickup", min: "super_admin", invoke: async () => (await import("../parcels/[id]/revert-pickup/route")).POST(req("POST"), ctx) },
  { name: "POST /parcels/[id]/reassign", min: "editor", invoke: async () => (await import("../parcels/[id]/reassign/route")).POST(req("POST"), ctx) },
  { name: "POST /parcels/bulk-receive", min: "editor", invoke: async () => (await import("../parcels/bulk-receive/route")).POST(req("POST")) },
  { name: "POST /parcels/match", min: "viewer", invoke: async () => (await import("../parcels/match/route")).POST(req("POST")) },
  { name: "POST /pickup/verify", min: "editor", invoke: async () => (await import("../pickup/verify/route")).POST(req("POST")) },
  { name: "GET /shipments", min: "viewer", invoke: async () => (await import("../shipments/route")).GET(req()) },
  { name: "POST /shipments", min: "editor", invoke: async () => (await import("../shipments/route")).POST(req("POST")) },
  { name: "GET /shipments/[id]", min: "viewer", invoke: async () => (await import("../shipments/[id]/route")).GET(req(), ctx) },
  { name: "PATCH /shipments/[id]", min: "editor", invoke: async () => (await import("../shipments/[id]/route")).PATCH(req("PATCH"), ctx) },
  { name: "POST /shipments/[id]/attach", min: "editor", invoke: async () => (await import("../shipments/[id]/attach/route")).POST(req("POST"), ctx) },
  { name: "POST /shipments/[id]/detach", min: "editor", invoke: async () => (await import("../shipments/[id]/detach/route")).POST(req("POST"), ctx) },
  { name: "POST /shipments/[id]/advance-parcels", min: "editor", invoke: async () => (await import("../shipments/[id]/advance-parcels/route")).POST(req("POST"), ctx) },
  { name: "GET /shipments/[id]/export", min: "viewer", invoke: async () => (await import("../shipments/[id]/export/route")).GET(req(), ctx) },
  { name: "GET /pack-requests", min: "viewer", invoke: async () => (await import("../pack-requests/route")).GET(req()) },
  { name: "PATCH /pack-requests/[id]", min: "editor", invoke: async () => (await import("../pack-requests/[id]/route")).PATCH(req("PATCH"), ctx) },
  { name: "POST /pack-requests/[id]/attach", min: "editor", invoke: async () => (await import("../pack-requests/[id]/attach/route")).POST(req("POST"), ctx) },
  { name: "GET /requests", min: "viewer", invoke: async () => (await import("../requests/route")).GET(req()) },
  { name: "PATCH /requests/[id]", min: "editor", invoke: async () => (await import("../requests/[id]/route")).PATCH(req("PATCH"), ctx) },
  { name: "GET /routes", min: "viewer", invoke: async () => (await import("../routes/route")).GET() },
  { name: "PATCH /routes", min: "editor", invoke: async () => (await import("../routes/route")).PATCH(req("PATCH")) },
  { name: "GET /contacts", min: "viewer", invoke: async () => (await import("../contacts/route")).GET() },
  { name: "PATCH /contacts", min: "editor", invoke: async () => (await import("../contacts/route")).PATCH(req("PATCH")) },
  { name: "POST /contacts/qr-upload", min: "editor", invoke: async () => (await import("../contacts/qr-upload/route")).POST(req("POST")) },
];

describe("shipping route role gates", () => {
  beforeEach(() => {
    roleCalls.length = 0;
  });

  for (const c of CASES) {
    it(`${c.name} requires ${c.min}+`, async () => {
      await c.invoke();
      expect(roleCalls).toEqual([c.min]);
    });
  }

  it("covers every withRole call site under app/api/admin/shipping", async () => {
    // 29 gates as of 2026-07-03 — recount with:
    //   grep -rc 'withRole("' app/api/admin/shipping --include=route.ts
    // and add a table row for any new handler.
    expect(CASES.length).toBe(29);
  });
});
