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

    const { data: sub, error: lookupError } = await admin
      .from("event_submissions")
      .select("id, status, title, description, date, location, category")
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

    const approvedThisWeek = await countApprovedSubmissionsThisWeek(admin);
    if (approvedThisWeek >= MARKETPLACE_WEEKLY_CAP) {
      return NextResponse.json(
        { error: "cap_reached", cap: MARKETPLACE_WEEKLY_CAP },
        { status: 429 },
      );
    }

    const { data: event, error: insertError } = await admin
      .from("events")
      .insert({
        title: sub.title,
        description: sub.description ?? null,
        date: sub.date ?? null,
        location: sub.location ?? null,
        category: sub.category ?? null,
        source: "community",
        status: "active",
      })
      .select("id")
      .single();
    if (insertError || !event) {
      return NextResponse.json(
        { error: "create_failed", details: insertError?.message },
        { status: 500 },
      );
    }

    const { error: updateError } = await admin
      .from("event_submissions")
      .update({
        status: "approved",
        approved_event_id: event.id,
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
      action: "event_submission.approve",
      entity_type: "event_submission",
      entity_id: id,
      payload: { event_id: event.id },
    });

    return NextResponse.json({ ok: true, event_id: event.id });
  });
}
