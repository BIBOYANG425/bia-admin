import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Re-send the invite email for a still-pending invitation. Reuses the same
 * Supabase `inviteUserByEmail` mechanism as POST /api/admin/members/invite,
 * but does NOT insert a new admin_invitations row — the existing row is the
 * source of truth. Only super_admins can do this.
 */
export async function POST(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    // Only act on a still-pending invitation (accepted_at IS NULL).
    const { data: invitation } = await admin
      .from("admin_invitations")
      .select("id, email, role, accepted_at")
      .eq("id", id)
      .maybeSingle();

    if (!invitation) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (invitation.accepted_at !== null) {
      return NextResponse.json({ error: "already_accepted" }, { status: 409 });
    }

    const origin = new URL(request.url).origin;
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      invitation.email,
      {
        redirectTo: `${origin}/auth/callback?next=/admin`,
        data: { invited_role: invitation.role, invited_by: auth.user.email },
      },
    );
    if (inviteErr) {
      return NextResponse.json(
        { error: "email_send_failed", details: inviteErr.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "invitation_resent",
      entity_type: "admin_invitation",
      entity_id: invitation.id,
      payload: { email: invitation.email, role: invitation.role },
    });

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const { data: invitation } = await admin
      .from("admin_invitations")
      .select("email")
      .eq("id", id)
      .maybeSingle();

    const { error } = await admin
      .from("admin_invitations")
      .delete()
      .eq("id", id)
      .is("accepted_at", null);
    if (error) {
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "invitation_revoked",
      entity_type: "admin_invitation",
      entity_id: id,
      payload: { email: invitation?.email ?? null },
    });

    return NextResponse.json({ ok: true });
  });
}
