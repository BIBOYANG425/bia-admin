import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockServerFrom, mockWriteAudit, mockRpc } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockServerFrom: vi.fn(),
    mockWriteAudit: vi.fn(),
    mockRpc: vi.fn(),
  }));

vi.mock("@biboyang425/bia-shared/next/supabase/server", () => ({
  createBiaServerClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockServerFrom,
  }),
}));

// The factory moved to the server-only subpath (bia-shared 1.0.0) — mock it there.
vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({
      rpc: mockRpc,
    }),
}));

vi.mock("@/lib/admin/audit-log", () => ({
  writeAudit: mockWriteAudit,
  writeAuditRequired: mockWriteAudit,
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
    mockWriteAudit.mockReset();
    mockRpc.mockReset();
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
    mockRpc.mockResolvedValue({ data: true, error: null });
    const res = await PATCH(
      makePatchRequest("u2", { role: "editor" }),
      ctxFor("u2"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockRpc).toHaveBeenCalledWith("admin_update_member_role_atomic", {
      p_admin_user_id: "u2",
      p_role: "editor",
      p_admin_email: "x@y",
    });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("404 when role update affects no admin row", async () => {
    setupServerSelfRead("super_admin");
    mockRpc.mockResolvedValue({ data: false, error: null });

    const res = await PATCH(
      makePatchRequest("missing", { role: "editor" }),
      ctxFor("missing"),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/members/[id]", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
    mockWriteAudit.mockReset();
    mockRpc.mockReset();
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
    mockRpc.mockResolvedValue({ data: true, error: null });
    const res = await DELETE(makeDeleteRequest("u2"), ctxFor("u2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockRpc).toHaveBeenCalledWith("admin_delete_member_atomic", {
      p_admin_user_id: "u2",
      p_admin_email: "x@y",
    });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("404 when delete affects no admin row", async () => {
    setupServerSelfRead("super_admin");
    mockRpc.mockResolvedValue({ data: false, error: null });

    const res = await DELETE(makeDeleteRequest("missing"), ctxFor("missing"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});
