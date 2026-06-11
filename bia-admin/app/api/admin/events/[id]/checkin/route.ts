// POST /api/admin/events/[id]/checkin — mark a student attended (or undo) (editor+).
// body: { student_id?: string, member_id?: string, checked_in: boolean }
//
// Attendance = checked_in_at IS NOT NULL; RSVP = rsvped_at IS NOT NULL (this
// route NEVER touches rsvped_at and never rewrites the legacy `source` column
// on existing rows). Check-in stamps checked_in_at only when it is still NULL
// (a repeat check-in keeps the original timestamp), or inserts a walk-in row
// (source='checkin' kept as legacy back-compat marker). Undo always just
// clears checked_in_at — this route never DELETEs attendance rows.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Body = z
  .object({
    student_id: z.string().uuid().optional(),
    member_id: z.string().optional(),
    checked_in: z.boolean(),
  })
  .strip();

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("editor", async () => {
    const { id: eventId } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const b = parsed.data;
    const admin = createBiaServiceRoleClient();

    let studentId = b.student_id ?? null;
    if (!studentId && b.member_id) {
      const { data: s } = await admin
        .from("students")
        .select("id")
        .eq("member_id", b.member_id.trim())
        .maybeSingle();
      if (!s) {
        return NextResponse.json({ error: "student_not_found" }, { status: 404 });
      }
      studentId = s.id as string;
    }
    if (!studentId) {
      return NextResponse.json({ error: "no_student" }, { status: 400 });
    }

    const fail = (details: string) =>
      NextResponse.json({ error: "checkin_failed", details }, { status: 500 });

    if (b.checked_in) {
      // Stamp checked_in_at on the existing row (RSVP'd student or walk-in).
      // The `checked_in_at IS NULL` guard preserves the ORIGINAL timestamp on
      // a repeat check-in (e.g. re-scanning a member_id that is already in)
      // instead of silently overwriting it with a later time. Only
      // checked_in_at is written — rsvped_at and source stay untouched.
      const checkedInAt = new Date().toISOString();
      const { data: updated, error: updateError } = await admin
        .from("event_attendance")
        .update({ checked_in_at: checkedInAt })
        .eq("student_id", studentId)
        .eq("event_id", eventId)
        .is("checked_in_at", null)
        .select("student_id");
      if (updateError) return fail(updateError.message);
      if (!updated || updated.length === 0) {
        // Nothing stamped: either the student is already checked in (keep the
        // original timestamp — idempotent no-op) or no row exists (walk-in).
        const { data: existing, error: existingError } = await admin
          .from("event_attendance")
          .select("student_id")
          .eq("student_id", studentId)
          .eq("event_id", eventId)
          .maybeSingle();
        if (existingError) return fail(existingError.message);
        if (!existing) {
          // No row yet → walk-in who never RSVP'd. source='checkin' is written
          // only as the legacy back-compat marker; nothing reads it for semantics.
          const { error: insertError } = await admin.from("event_attendance").insert({
            student_id: studentId,
            event_id: eventId,
            source: "checkin",
            rsvped_at: null,
            checked_in_at: checkedInAt,
          });
          if (insertError) return fail(insertError.message);
        }
      }
    } else {
      // Undo: clear the attendance stamp, keep the row. This route NEVER
      // deletes — roommate PR #63's migration backfills
      // checked_in_at = created_at for legacy source='checkin' rows, which
      // makes a historical roster row indistinguishable (by column values)
      // from a fresh walk-in this route just created, so any delete here
      // could destroy pre-migration audit history (created_at and the row
      // itself). A cleared walk-in row simply stays as a touchpoint record.
      // Never write source='rsvp' (the old code fabricated RSVPs for
      // walk-ins here) and never touch rsvped_at.
      const { error: clearError } = await admin
        .from("event_attendance")
        .update({ checked_in_at: null })
        .eq("student_id", studentId)
        .eq("event_id", eventId);
      if (clearError) return fail(clearError.message);
    }

    return NextResponse.json({
      ok: true,
      student_id: studentId,
      checked_in: b.checked_in,
    });
  });
}
