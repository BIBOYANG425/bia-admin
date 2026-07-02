import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const InviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(["super_admin", "editor", "viewer"]),
});

export async function POST(request: Request) {
  return withRole("super_admin", async (ctx) => {
    const json = await request.json().catch(() => null);
    const parsed = InviteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const { email, role } = parsed.data;
    const admin = createBiaServiceRoleClient();

    const { data: existing } = await admin
      .from("admin_users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "already_admin" }, { status: 409 });
    }

    const { data: invitation, error: insertErr } = await admin
      .from("admin_invitations")
      .insert({ email, role, invited_by: ctx.user.id })
      .select()
      .single();
    if (insertErr) {
      if (insertErr.code === "23505") {
        return NextResponse.json({ error: "already_invited" }, { status: 409 });
      }
      return NextResponse.json(
        { error: "insert_failed", details: insertErr.message },
        { status: 500 },
      );
    }

    const origin = new URL(request.url).origin;
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: `${origin}/auth/callback?next=/admin`,
        data: { invited_role: role, invited_by: ctx.user.email },
      },
    );
    if (inviteErr) {
      await admin.from("admin_invitations").delete().eq("id", invitation.id);
      return NextResponse.json(
        { error: "email_send_failed", details: inviteErr.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: ctx.user.email,
      action: "invite_sent",
      entity_type: "admin_invitation",
      entity_id: invitation.id,
      payload: { email, role },
    });

    return NextResponse.json({ ok: true, invitation });
  });
}
