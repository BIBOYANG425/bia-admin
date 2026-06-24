// POST /api/admin/squad/[id]/cancel — take a squad 局 down (editor+).
// Moderation lever: sets cancelled_at, which flips the derived status (via
// squad_posts_with_status) to 'closed' / 「已取消」. There is no separate
// hidden flag in the schema, so cancellation IS the takedown. Optional body
// { reason?: string } is recorded in the audit payload. Idempotent: a post
// that is already cancelled returns 409.
import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const reason =
      typeof body?.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : null;

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
    if (post.cancelled_at) {
      return NextResponse.json({ error: "already_cancelled" }, { status: 409 });
    }

    const { data: updated, error: updateError } = await admin
      .from("squad_posts")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", id)
      // Guard against a concurrent cancel: only flip an open post.
      .is("cancelled_at", null)
      .select("id");
    if (updateError) {
      return NextResponse.json(
        { error: "update_failed", details: updateError.message },
        { status: 500 },
      );
    }
    // A 0-row UPDATE returns no error — a concurrent cancel already won. Don't
    // write a phantom audit entry for a state change that didn't happen.
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "already_cancelled" }, { status: 409 });
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "squad_post.cancel",
      entity_type: "squad_post",
      entity_id: id,
      payload: reason ? { reason } : {},
    });

    return NextResponse.json({ ok: true });
  });
}
