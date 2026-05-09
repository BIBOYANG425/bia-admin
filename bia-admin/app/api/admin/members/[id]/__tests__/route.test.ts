import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockServerFrom, mockServiceFrom, mockWriteAudit } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockServerFrom: vi.fn(),
    mockServiceFrom: vi.fn(),
    mockWriteAudit: vi.fn(),
  }));

vi.mock("@bia/shared/next/supabase/server", () => ({
  createBiaServerClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockServerFrom,
  }),
}));

vi.mock("@bia/shared", async (importActual) => {
  const actual = await importActual<typeof import("@bia/shared")>();
  return {
    ...actual,
    createBiaServiceRoleClient: () => ({
      from: mockServiceFrom,
    }),
  };
});

vi.mock("@/lib/admin/audit-log", () => ({
  writeAudit: mockWriteAudit,
}));

import { PATCH, DELETE } from "../route";

function setupServerSelfRead(
  role: "super_admin" | "editor" | "viewer" | null,
) {
  if (role === null) {
    mockServerFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: () => ({ data: null, error: null }) }),
      }),
    });
  } else {
    mockServerFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => ({
            data: { id: "u1", email: "x@y", role, created_at: "" },
            error: null,
          }),
        }),
      }),
    });
  }
}

interface ServiceFromOpts {
  updateError?: unknown;
  deleteError?: unknown;
}

function setupServiceFrom(opts: ServiceFromOpts = {}) {
  const { updateError = null, deleteError = null } = opts;
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === "admin_users") {
      return {
        update: () => ({
          eq: () => Promise.resolve({ error: updateError }),
        }),
        delete: () => ({
          eq: () => Promise.resolve({ error: deleteError }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

function makePatchRequest(id: string, body: unknown) {
  return new Request(`http://localhost/api/admin/members/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeDeleteRequest(id: string) {
  return new Request(`http://localhost/api/admin/members/${id}`, {
    method: "DELETE",
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/members/[id]", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
    mockServiceFrom.mockReset();
    mockWriteAudit.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
  });

  it("403 when caller is not super_admin", async () => {
    setupServerSelfRead("editor");
    const res = await PATCH(
      makePatchRequest("u2", { role: "editor" }),
      ctxFor("u2"),
    );
    expect(res.status).toBe(403);
  });

  it("400 when body is invalid", async () => {
    setupServerSelfRead("super_admin");
    const res = await PATCH(makePatchRequest("u2", {}), ctxFor("u2"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("400 cannot_change_own_role when target id matches caller", async () => {
    setupServerSelfRead("super_admin");
    const res = await PATCH(
      makePatchRequest("u1", { role: "editor" }),
      ctxFor("u1"),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cannot_change_own_role" });
  });

  it("200 success: updates role + writes audit log", async () => {
    setupServerSelfRead("super_admin");
    setupServiceFrom({ updateError: null });
    const res = await PATCH(
      makePatchRequest("u2", { role: "editor" }),
      ctxFor("u2"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockWriteAudit).toHaveBeenCalledWith({
      admin_email: "x@y",
      action: "role_changed",
      entity_type: "admin_user",
      entity_id: "u2",
      payload: { role: "editor" },
    });
  });
});

describe("DELETE /api/admin/members/[id]", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
    mockServiceFrom.mockReset();
    mockWriteAudit.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
  });

  it("400 cannot_delete_self when target id matches caller", async () => {
    setupServerSelfRead("super_admin");
    const res = await DELETE(makeDeleteRequest("u1"), ctxFor("u1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cannot_delete_self" });
  });

  it("200 success: deletes admin + writes audit log", async () => {
    setupServerSelfRead("super_admin");
    setupServiceFrom({ deleteError: null });
    const res = await DELETE(makeDeleteRequest("u2"), ctxFor("u2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockWriteAudit).toHaveBeenCalledWith({
      admin_email: "x@y",
      action: "admin_removed",
      entity_type: "admin_user",
      entity_id: "u2",
    });
  });
});
