// POST /api/admin/squad/[id]/reopen — undo a cancellation (editor+).
// Clears cancelled_at; the derived status (squad_posts_with_status) then
// recomputes back to open/full/expired. Used to recover from a mistaken
// takedown. Idempotent: a post that is not cancelled returns 409.
import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const { data: post, error: lookupError } = await admin
      .from("squad_posts")
      .select("id, cancelled_at")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json(
        { error: "lookup_failed", details: lookupError.message },
        { status: 500 },
      );
    }
    if (!post) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!post.cancelled_at) {
      return NextResponse.json({ error: "not_cancelled" }, { status: 409 });
    }

    const { error: updateError } = await admin
      .from("squad_posts")
      .update({ cancelled_at: null })
      .eq("id", id);
    if (updateError) {
      return NextResponse.json(
        { error: "update_failed", details: updateError.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "squad_post.reopen",
      entity_type: "squad_post",
      entity_id: id,
      payload: {},
    });

    return NextResponse.json({ ok: true });
  });
}
