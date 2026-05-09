// Server-only — requires Next 16 middleware runtime (`next/server`). Importing
// this module from non-Next code (tests, scripts, framework-agnostic libs) will
// fail at import time. Call from a Next middleware.ts handler only.
//
// Header last reviewed: 2026-05-08
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateBiaSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return supabaseResponse;

  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      supabaseResponse = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        supabaseResponse.cookies.set(name, value, options);
      }
    },
  };

  const supabase = createServerClient(url, key, { cookies: cookieMethods });

  await supabase.auth.getUser();
  return supabaseResponse;
}
