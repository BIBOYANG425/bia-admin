import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";

const mockExchangeCode = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();
const mockServiceFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@biboyang425/bia-shared/next/supabase/server", () => ({
  createBiaServerClient: async () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCode,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));

vi.mock("@biboyang425/bia-shared", async (importActual) => {
  const actual = await importActual<typeof import("@biboyang425/bia-shared")>();
  return {
    ...actual,
    createBiaServiceRoleClient: () => ({
      from: mockServiceFrom,
      rpc: mockRpc,
    }),
  };
});

interface ServiceFromOpts {
  existingAdmin: { id: string } | null;
  pendingInvite: { id: string; role: string } | null;
  auditOk?: boolean;
}

function setupServiceFrom({
  existingAdmin,
  pendingInvite,
  auditOk = true,
}: ServiceFromOpts) {
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === "admin_users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => ({ data: existingAdmin, error: null }),
          }),
        }),
      };
    }
    if (table === "admin_invitations") {
      return {
        select: () => ({
          ilike: () => ({
            is: () => ({
              maybeSingle: () => ({ data: pendingInvite, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === "admin_audit_log") {
      return {
        insert: () =>
          Promise.resolve({
            error: auditOk ? null : { message: "audit failed" },
          }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    mockExchangeCode.mockReset();
    mockGetUser.mockReset();
    mockSignOut.mockReset();
    mockServiceFrom.mockReset();
    mockRpc.mockReset();
  });

  it("redirects to /login?denied=auth_error when no code param", async () => {
    const res = await GET(new Request("http://localhost/auth/callback"));
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?denied=auth_error",
    );
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it("redirects to /login?denied=auth_error when exchangeCodeForSession errors", async () => {
    mockExchangeCode.mockResolvedValue({ error: { message: "bad code" } });
    const res = await GET(
      new Request("http://localhost/auth/callback?code=abc"),
    );
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?denied=auth_error",
    );
  });

  it("redirects to /login?denied=auth_error when no user/email after exchange", async () => {
    mockExchangeCode.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(
      new Request("http://localhost/auth/callback?code=abc"),
    );
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?denied=auth_error",
    );
  });

  it("redirects to next path when user already has an admin_users row", async () => {
    mockExchangeCode.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    setupServiceFrom({
      existingAdmin: { id: "u1" },
      pendingInvite: null,
    });
    const res = await GET(
      new Request("http://localhost/auth/callback?code=abc&next=/admin/blog"),
    );
    expect(res.headers.get("location")).toBe("http://localhost/admin/blog");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls accept_invitation RPC and redirects to /admin when pending invite found", async () => {
    mockExchangeCode.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    setupServiceFrom({
      existingAdmin: null,
      pendingInvite: { id: "inv1", role: "editor" },
    });
    mockRpc.mockResolvedValue({ error: null });

    const res = await GET(
      new Request("http://localhost/auth/callback?code=abc"),
    );

    expect(mockRpc).toHaveBeenCalledWith("accept_invitation", {
      p_invitation_id: "inv1",
      p_user_id: "u1",
      p_email: "x@y",
    });
    expect(res.headers.get("location")).toBe("http://localhost/admin");
  });

  it("signs out and redirects to /login?denied=not-invited when no admin row and no invite", async () => {
    mockExchangeCode.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    setupServiceFrom({
      existingAdmin: null,
      pendingInvite: null,
    });

    const res = await GET(
      new Request("http://localhost/auth/callback?code=abc"),
    );

    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?denied=not-invited",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("signs out and redirects to /login?denied=invite_failed when RPC errors", async () => {
    mockExchangeCode.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    setupServiceFrom({
      existingAdmin: null,
      pendingInvite: { id: "inv1", role: "editor" },
    });
    mockRpc.mockResolvedValue({ error: { message: "rpc failed" } });

    const res = await GET(
      new Request("http://localhost/auth/callback?code=abc"),
    );

    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?denied=invite_failed",
    );
  });
});
