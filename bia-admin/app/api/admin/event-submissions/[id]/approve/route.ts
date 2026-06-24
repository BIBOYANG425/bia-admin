// POST /api/admin/event-submissions/[id]/approve — promote a pending student
// event submission into the live events table (editor+). Enforces the weekly
// marketplace cap. Idempotency guard: only 'pending' submissions can be approved.
import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import {
  MARKETPLACE_WEEKLY_CAP,
  countApprovedSubmissionsThisWeek,
} from "@/lib/marketplace/cap-enforcement";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    // Cap check stays in the route (a count query); the insert+update are made
    // atomic by the approve_event_submission RPC.
    const approvedThisWeek = await countApprovedSubmissionsThisWeek(admin);
    if (approvedThisWeek >= MARKETPLACE_WEEKLY_CAP) {
      return NextResponse.json(
        { error: "cap_reached", cap: MARKETPLACE_WEEKLY_CAP },
        { status: 429 },
      );
    }

    const { data: eventId, error: rpcError } = await admin.rpc(
      "approve_event_submission",
      { p_submission_id: id, p_admin_id: auth.adminUser.id },
    );
    if (rpcError) {
      const msg = rpcError.message ?? "";
      if (msg.includes("not_found")) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (msg.includes("invalid_transition")) {
        return NextResponse.json(
          { error: "invalid_transition", details: msg },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "approve_failed", details: msg },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "event_submission.approve",
      entity_type: "event_submission",
      entity_id: id,
      payload: { event_id: eventId },
    });

    return NextResponse.json({ ok: true, event_id: eventId });
  });
}
