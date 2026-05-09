import { NextResponse } from "next/server";
import {
  roleAtLeast,
  type AdminUser,
  type Role,
} from "@biboyang425/bia-shared";
import { createBiaServerClient } from "@biboyang425/bia-shared/next/supabase/server";

export class RoleError extends Error {
  constructor(
    public status: 401 | 403,
    public code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export interface RequireRoleResult {
  user: { id: string; email: string };
  role: Role;
  adminUser: AdminUser;
}

export async function requireRole(min: Role): Promise<RequireRoleResult> {
  const supa = await createBiaServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) throw new RoleError(401, "no_session");

  // Self-read uses authenticated cookie-bound client; RLS self-read policy permits.
  const { data, error } = await supa
    .from("admin_users")
    .select("id, email, role, created_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new RoleError(403, "lookup_failed");
  if (!data) throw new RoleError(403, "not_admin");

  const adminUser = data as AdminUser;
  if (!roleAtLeast(adminUser.role, min)) {
    throw new RoleError(403, `role_required: ${min}`);
  }

  return {
    user: { id: user.id, email: user.email ?? adminUser.email },
    role: adminUser.role,
    adminUser,
  };
}

/**
 * Wraps an API route handler with role gating + standard error mapping.
 * Replaces the duplicated try/catch pattern across handlers.
 *
 * Returns are typed as NextResponse (no generic) so handlers can freely
 * return union response types (success JSON vs error JSON) without
 * fighting the type system.
 */
export async function withRole(
  min: Role,
  handler: (ctx: RequireRoleResult) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const ctx = await requireRole(min);
    return await handler(ctx);
  } catch (err) {
    if (err instanceof RoleError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}
