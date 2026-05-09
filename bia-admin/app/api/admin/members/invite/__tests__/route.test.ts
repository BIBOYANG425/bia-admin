import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetUser,
  mockServerFrom,
  mockServiceFrom,
  mockInviteUserByEmail,
  mockWriteAudit,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServerFrom: vi.fn(),
  mockServiceFrom: vi.fn(),
  mockInviteUserByEmail: vi.fn(),
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
      auth: { admin: { inviteUserByEmail: mockInviteUserByEmail } },
    }),
  };
});

vi.mock("@/lib/admin/audit-log", () => ({
  writeAudit: mockWriteAudit,
}));

import { POST } from "../route";

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
  existingAdmin?: { id: string } | null;
  insertResult?: { data: unknown; error: unknown };
  deleteSpy?: ReturnType<typeof vi.fn>;
}

function setupServiceFrom(opts: ServiceFromOpts) {
  const {
    existingAdmin = null,
    insertResult = { data: { id: "inv1" }, error: null },
    deleteSpy,
  } = opts;
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === "admin_users") {
      return {
        select: () => ({
          ilike: () => ({
            maybeSingle: () => ({ data: existingAdmin, error: null }),
          }),
        }),
      };
    }
    if (table === "admin_invitations") {
      return {
        insert: () => ({
          select: () => ({
            single: () => insertResult,
          }),
        }),
        delete: () => ({
          eq: (col: string, val: string) => {
            deleteSpy?.(col, val);
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/members/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/admin/members/invite", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
    mockServiceFrom.mockReset();
    mockInviteUserByEmail.mockReset();
    mockWriteAudit.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
  });

  it("403 when caller is not super_admin", async () => {
    setupServerSelfRead("editor");
    const res = await POST(
      makeRequest({ email: "ex@example.com", role: "editor" }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "role_required: super_admin" });
  });

  it("400 when body is invalid", async () => {
    setupServerSelfRead("super_admin");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  it("409 already_admin when email is already an admin", async () => {
    setupServerSelfRead("super_admin");
    setupServiceFrom({ existingAdmin: { id: "ex" } });
    const res = await POST(
      makeRequest({ email: "ex@example.com", role: "editor" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_admin" });
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
  });

  it("409 already_invited on unique constraint (23505)", async () => {
    setupServerSelfRead("super_admin");
    setupServiceFrom({
      existingAdmin: null,
      insertResult: { data: null, error: { code: "23505" } },
    });
    const res = await POST(
      makeRequest({ email: "ex@example.com", role: "editor" }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_invited" });
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
  });

  it("500 + rolls back invitation when email send fails", async () => {
    setupServerSelfRead("super_admin");
    const deleteSpy = vi.fn();
    setupServiceFrom({
      existingAdmin: null,
      insertResult: { data: { id: "inv1" }, error: null },
      deleteSpy,
    });
    mockInviteUserByEmail.mockResolvedValue({
      error: { message: "smtp down" },
    });
    const res = await POST(
      makeRequest({ email: "ex@example.com", role: "editor" }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "email_send_failed",
      details: "smtp down",
    });
    expect(deleteSpy).toHaveBeenCalledWith("id", "inv1");
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("200 success: invites email + writes audit log", async () => {
    setupServerSelfRead("super_admin");
    const invitationRow = {
      id: "inv1",
      email: "ex@example.com",
      role: "editor",
    };
    setupServiceFrom({
      existingAdmin: null,
      insertResult: { data: invitationRow, error: null },
    });
    mockInviteUserByEmail.mockResolvedValue({ error: null });

    const res = await POST(
      makeRequest({ email: "ex@example.com", role: "editor" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, invitation: invitationRow });

    expect(mockWriteAudit).toHaveBeenCalledWith({
      admin_email: "x@y",
      action: "invite_sent",
      entity_type: "admin_invitation",
      entity_id: "inv1",
      payload: { email: "ex@example.com", role: "editor" },
    });
  });
});
