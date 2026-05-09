// Server-only — requires Next 16 `next/headers`. Importing this module from
// non-Next code (tests, scripts, framework-agnostic libs) will fail at import
// time. Use @biboyang425/bia-shared/supabase/browser or @biboyang425/bia-shared/supabase/service-role
// for non-Next contexts.
//
// Header last reviewed: 2026-05-08
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createBiaServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // setAll can fail in Server Components (read-only).
        // Middleware handles the refresh.
      }
    },
  };

  return createServerClient(url, key, { cookies: cookieMethods });
}
