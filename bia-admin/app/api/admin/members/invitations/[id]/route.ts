import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@bia/shared";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
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
