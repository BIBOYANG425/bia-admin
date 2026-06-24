import { updateBiaSession } from "@biboyang425/bia-shared/next/supabase/middleware";
import type { NextRequest } from "next/server";

/**
 * This middleware ONLY refreshes the Supabase auth cookie (delegating to
 * updateBiaSession). It does NOT itself check `admin_users` or enforce roles.
 *
 * Role gating is enforced one layer deeper, at the layout/page boundary:
 * every `(admin)/` route renders through `components/AdminShell.tsx`, and
 * server actions / API routes call `requireRole(...)` (see
 * `lib/auth/require-role.ts`). Those layers read `admin_users` with the
 * cookie-bound client and redirect / 403 callers without a row.
 *
 * Keeping the gate at the layout/route layer (rather than here) avoids an
 * extra DB round-trip on every static/asset request and keeps the middleware
 * edge-safe. Treat this file as cookie refresh + defense-in-depth, NOT the
 * authorization boundary. Do not assume a request that reaches a page handler
 * is already authorized — always go through requireRole / AdminShell.
 */
export async function middleware(request: NextRequest) {
  return updateBiaSession(request);
}

export const config = {
  matcher: [
    // Skip Next internals + static + auth callback (to avoid infinite redirect)
    "/((?!_next/static|_next/image|favicon.ico|login|auth/).*)",
  ],
};
