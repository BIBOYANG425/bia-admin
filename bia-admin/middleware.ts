import { updateBiaSession } from "@bia/shared/next/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateBiaSession(request);
}

export const config = {
  matcher: [
    // Skip Next internals + static + auth callback (to avoid infinite redirect)
    "/((?!_next/static|_next/image|favicon.ico|login|auth/).*)",
  ],
};
