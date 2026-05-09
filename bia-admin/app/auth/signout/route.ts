import { NextResponse } from "next/server";
import { createBiaServerClient } from "@biboyang425/bia-shared/next/supabase/server";

export async function POST(request: Request) {
  const supa = await createBiaServerClient();
  await supa.auth.signOut();
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/login`, 303);
}
