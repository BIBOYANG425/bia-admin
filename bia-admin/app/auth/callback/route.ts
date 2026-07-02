import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { createBiaServerClient } from "@biboyang425/bia-shared/next/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?denied=auth_error`);
  }

  const supa = await createBiaServerClient();
  const { error: exchangeErr } = await supa.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return NextResponse.redirect(`${origin}/login?denied=auth_error`);
  }

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.redirect(`${origin}/login?denied=auth_error`);
  }

  const admin = createBiaServiceRoleClient();

  // Already an admin? Just go.
  const { data: existing } = await admin
    .from("admin_users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Look for a pending invitation by email (case-insensitive).
  const { data: invitation } = await admin
    .from("admin_invitations")
    .select("id, role")
    .ilike("email", user.email)
    .is("accepted_at", null)
    .maybeSingle();

  if (!invitation) {
    await supa.auth.signOut();
    return NextResponse.redirect(`${origin}/login?denied=not-invited`);
  }

  // Atomic accept: RPC inserts admin_users + marks invitation accepted in one tx.
  const { error: rpcErr } = await admin.rpc("accept_invitation", {
    p_invitation_id: invitation.id,
    p_user_id: user.id,
    p_email: user.email,
  });
  if (rpcErr) {
    await supa.auth.signOut();
    return NextResponse.redirect(`${origin}/login?denied=invite_failed`);
  }

  // Audit (best-effort).
  await admin.from("admin_audit_log").insert({
    admin_email: user.email,
    action: "accept_invitation",
    entity_type: "admin_user",
    entity_id: user.id,
    payload: { invitation_id: invitation.id, role: invitation.role },
  });

  return NextResponse.redirect(`${origin}${next}`);
}
