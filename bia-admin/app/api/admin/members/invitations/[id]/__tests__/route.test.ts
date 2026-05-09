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

import { DELETE } from "../route";

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

function makeRequest(id: string) {
  return new Request(`http://localhost/api/admin/members/invitations/${id}`, {
    method: "DELETE",
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
