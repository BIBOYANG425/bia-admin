import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";

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
    const { data: updated, error } = await admin.rpc(
      "admin_update_member_role_atomic",
      {
        p_admin_user_id: id,
        p_role: parsed.data.role,
        p_admin_email: auth.user.email,
      },
    );
    if (error) {
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

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
    const { data: deleted, error } = await admin.rpc(
      "admin_delete_member_atomic",
      { p_admin_user_id: id, p_admin_email: auth.user.email },
    );
    if (error) {
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }
    if (!deleted) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
