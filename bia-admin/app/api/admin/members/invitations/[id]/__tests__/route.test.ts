import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetUser,
  mockServerFrom,
  mockServiceFrom,
  mockWriteAudit,
  mockInviteUserByEmail,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockServerFrom: vi.fn(),
  mockServiceFrom: vi.fn(),
  mockWriteAudit: vi.fn(),
  mockInviteUserByEmail: vi.fn(),
}));

vi.mock("@biboyang425/bia-shared/next/supabase/server", () => ({
  createBiaServerClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockServerFrom,
  }),
}));

vi.mock("@biboyang425/bia-shared", async (importActual) => {
  const actual = await importActual<typeof import("@biboyang425/bia-shared")>();
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

import { DELETE, POST } from "../route";

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
  invitationLookup?: { email: string } | null;
  deleteError?: unknown;
}

function setupServiceFrom(opts: ServiceFromOpts = {}) {
  const { invitationLookup = null, deleteError = null } = opts;
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === "admin_invitations") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => ({ data: invitationLookup, error: null }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            is: () => Promise.resolve({ error: deleteError }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

interface ResendServiceOpts {
  invitationLookup?:
    | { id: string; email: string; role: string; accepted_at: string | null }
    | null;
}

function setupResendServiceFrom(opts: ResendServiceOpts = {}) {
  const { invitationLookup = null } = opts;
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === "admin_invitations") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => ({ data: invitationLookup, error: null }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

function makeRequest(id: string) {
  return new Request(`http://localhost/api/admin/members/invitations/${id}`, {
    method: "DELETE",
  });
}

function makePostRequest(id: string) {
  return new Request(`http://localhost/api/admin/members/invitations/${id}`, {
    method: "POST",
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/admin/members/invitations/[id]", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
    mockServiceFrom.mockReset();
    mockWriteAudit.mockReset();
    mockInviteUserByEmail.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
  });

  it("403 when caller is not super_admin", async () => {
    setupServerSelfRead("editor");
    const res = await DELETE(makeRequest("inv1"), ctxFor("inv1"));
    expect(res.status).toBe(403);
  });

  it("200 success: deletes invitation + writes audit log with prior email", async () => {
    setupServerSelfRead("super_admin");
    setupServiceFrom({
      invitationLookup: { email: "officer@y" },
      deleteError: null,
    });

    const res = await DELETE(makeRequest("inv1"), ctxFor("inv1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockWriteAudit).toHaveBeenCalledWith({
      admin_email: "x@y",
      action: "invitation_revoked",
      entity_type: "admin_invitation",
      entity_id: "inv1",
      payload: { email: "officer@y" },
    });
  });
});

describe("POST /api/admin/members/invitations/[id] (resend)", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
    mockServiceFrom.mockReset();
    mockWriteAudit.mockReset();
    mockInviteUserByEmail.mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
  });

  it("403 when caller is not super_admin", async () => {
    setupServerSelfRead("editor");
    const res = await POST(makePostRequest("inv1"), ctxFor("inv1"));
    expect(res.status).toBe(403);
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
  });

  it("404 when invitation does not exist", async () => {
    setupServerSelfRead("super_admin");
    setupResendServiceFrom({ invitationLookup: null });
    const res = await POST(makePostRequest("inv1"), ctxFor("inv1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
  });

  it("409 already_accepted when invitation has been accepted", async () => {
    setupServerSelfRead("super_admin");
    setupResendServiceFrom({
      invitationLookup: {
        id: "inv1",
        email: "officer@y",
        role: "editor",
        accepted_at: "2026-01-01T00:00:00Z",
      },
    });
    const res = await POST(makePostRequest("inv1"), ctxFor("inv1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_accepted" });
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
  });

  it("500 email_send_failed when invite email fails (no audit)", async () => {
    setupServerSelfRead("super_admin");
    setupResendServiceFrom({
      invitationLookup: {
        id: "inv1",
        email: "officer@y",
        role: "editor",
        accepted_at: null,
      },
    });
    mockInviteUserByEmail.mockResolvedValue({ error: { message: "smtp down" } });
    const res = await POST(makePostRequest("inv1"), ctxFor("inv1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "email_send_failed",
      details: "smtp down",
    });
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("200 success: re-sends invite (no new row) + writes audit log", async () => {
    setupServerSelfRead("super_admin");
    setupResendServiceFrom({
      invitationLookup: {
        id: "inv1",
        email: "officer@y",
        role: "editor",
        accepted_at: null,
      },
    });
    mockInviteUserByEmail.mockResolvedValue({ error: null });

    const res = await POST(makePostRequest("inv1"), ctxFor("inv1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockInviteUserByEmail).toHaveBeenCalledWith("officer@y", {
      redirectTo: "http://localhost/auth/callback?next=/admin",
      data: { invited_role: "editor", invited_by: "x@y" },
    });
    expect(mockWriteAudit).toHaveBeenCalledWith({
      admin_email: "x@y",
      action: "invitation_resent",
      entity_type: "admin_invitation",
      entity_id: "inv1",
      payload: { email: "officer@y", role: "editor" },
    });
  });
});
