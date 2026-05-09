import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { roleAtLeast } from "@bia/shared";
import { requireRole, withRole, RoleError } from "../require-role";

describe("roleAtLeast", () => {
  it("super_admin satisfies every role", () => {
    expect(roleAtLeast("super_admin", "super_admin")).toBe(true);
    expect(roleAtLeast("super_admin", "editor")).toBe(true);
    expect(roleAtLeast("super_admin", "viewer")).toBe(true);
  });

  it("editor satisfies editor and viewer but not super_admin", () => {
    expect(roleAtLeast("editor", "super_admin")).toBe(false);
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast("editor", "viewer")).toBe(true);
  });

  it("viewer satisfies only viewer", () => {
    expect(roleAtLeast("viewer", "super_admin")).toBe(false);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
  });
});

const mockGetUser = vi.fn();
const mockServerFrom = vi.fn(); // cookie-bound client (self-read)
const mockServiceFrom = vi.fn(); // service-role client (cross-user reads)

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
    createBiaServiceRoleClient: () => ({ from: mockServiceFrom }),
  };
});

function mockSelfRead(data: unknown, error: unknown = null) {
  mockServerFrom.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle: () => ({ data, error }) }),
    }),
  });
}

describe("requireRole", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
    mockServiceFrom.mockReset();
  });

  it("throws 401 when no user session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(requireRole("viewer")).rejects.toMatchObject({
      status: 401,
      code: "no_session",
    });
  });

  it("throws 403 when user has no admin_users row", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead(null);
    await expect(requireRole("viewer")).rejects.toMatchObject({
      status: 403,
      code: "not_admin",
    });
  });

  it("throws 403 with lookup_failed when supabase errors", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead(null, { message: "network down" });
    await expect(requireRole("viewer")).rejects.toMatchObject({
      status: 403,
      code: "lookup_failed",
    });
  });

  it("throws 403 when role insufficient", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead({ id: "u1", email: "x@y", role: "viewer" });
    await expect(requireRole("super_admin")).rejects.toMatchObject({
      status: 403,
      code: "role_required: super_admin",
    });
  });

  it("returns user + role when role sufficient", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead({ id: "u1", email: "x@y", role: "super_admin" });
    const result = await requireRole("editor");
    expect(result.role).toBe("super_admin");
    expect(result.user.id).toBe("u1");
  });
});

describe("withRole", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockServerFrom.mockReset();
  });

  it("maps RoleError to NextResponse with status + error code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const handler = vi.fn();
    const res = await withRole("viewer", handler);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "no_session" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls handler with ctx when role sufficient", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "x@y" } },
    });
    mockSelfRead({ id: "u1", email: "x@y", role: "super_admin" });
    const handler = vi.fn(
      async (_ctx: Parameters<Parameters<typeof withRole>[1]>[0]) =>
        NextResponse.json({ ok: true }, { status: 200 }),
    );
    const res = await withRole("editor", handler);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const ctx = handler.mock.calls[0]?.[0];
    expect(ctx?.role).toBe("super_admin");
    expect(ctx?.user.id).toBe("u1");
  });

  it("propagates non-RoleError exceptions", async () => {
    mockGetUser.mockImplementation(() => {
      throw new Error("network");
    });
    const handler = vi.fn();
    await expect(withRole("viewer", handler)).rejects.toThrow("network");
    expect(handler).not.toHaveBeenCalled();
  });
});

// Reference RoleError to ensure the import is exercised.
void RoleError;
