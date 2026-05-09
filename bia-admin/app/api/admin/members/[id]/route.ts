import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const PatchSchema = z.object({
  role: z.enum(["super_admin", "editor", "viewer"]),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    if (id === auth.user.id) {
      return NextResponse.json(
        { error: "cannot_change_own_role" },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const { error } = await admin
      .from("admin_users")
      .update({ role: parsed.data.role })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "role_changed",
      entity_type: "admin_user",
      entity_id: id,
      payload: { role: parsed.data.role },
    });

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    if (id === auth.user.id) {
      return NextResponse.json(
        { error: "cannot_delete_self" },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const { error } = await admin.from("admin_users").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "admin_removed",
      entity_type: "admin_user",
      entity_id: id,
    });

    return NextResponse.json({ ok: true });
  });
}
