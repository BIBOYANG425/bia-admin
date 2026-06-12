// POST /api/admin/event-submissions/[id]/reject — decline a pending student
// event submission (editor+). Optional body { reason?: string }. Only 'pending'
// submissions can be rejected.
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
      typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    const admin = createBiaServiceRoleClient();

    const { data: sub, error: lookupError } = await admin
      .from("event_submissions")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json(
        { error: "lookup_failed", details: lookupError.message },
        { status: 500 },
      );
    }
    if (!sub) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (sub.status !== "pending") {
      return NextResponse.json(
        { error: "invalid_transition", from: sub.status },
        { status: 409 },
      );
    }

    const { error: updateError } = await admin
      .from("event_submissions")
      .update({
        status: "rejected",
        reject_reason: reason,
        decided_by: auth.adminUser.id,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) {
      return NextResponse.json(
        { error: "update_failed", details: updateError.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "event_submission.reject",
      entity_type: "event_submission",
      entity_id: id,
      payload: reason ? { reason } : {},
    });

    return NextResponse.json({ ok: true });
  });
}
