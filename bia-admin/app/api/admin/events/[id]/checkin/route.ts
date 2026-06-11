// POST /api/admin/events/[id]/checkin — mark a student attended (or undo) (editor+).
// body: { student_id?: string, member_id?: string, checked_in: boolean }
//
// Attendance = checked_in_at IS NOT NULL; RSVP = rsvped_at IS NOT NULL (this
// route NEVER touches rsvped_at and never rewrites the legacy `source` column
// on existing rows). Check-in stamps checked_in_at on the existing row, or
// inserts a walk-in row (source='checkin' kept as legacy back-compat marker).
// Undo clears checked_in_at; a never-RSVP'd walk-in row is deleted outright.

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
      // Stamp checked_in_at on the existing row (RSVP'd student or re-check-in).
      // Only checked_in_at is written — rsvped_at and source stay untouched.
      const checkedInAt = new Date().toISOString();
      const { data: updated, error: updateError } = await admin
        .from("event_attendance")
        .update({ checked_in_at: checkedInAt })
        .eq("student_id", studentId)
        .eq("event_id", eventId)
        .select("student_id");
      if (updateError) return fail(updateError.message);
      if (!updated || updated.length === 0) {
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
    } else {
      // Undo. A walk-in row this route created (rsvped_at IS NULL + a live
      // checked_in_at + source='checkin') never represented an RSVP, so undo
      // deletes it outright — restoring the "was never here" state instead of
      // leaving a ghost row. `source` is read here ONLY as a safety guard so
      // legacy pre-migration RSVP rows (rsvped_at still NULL, source='rsvp')
      // can never be deleted; it is not used for RSVP/attendance semantics.
      const { data: deleted, error: deleteError } = await admin
        .from("event_attendance")
        .delete()
        .eq("student_id", studentId)
        .eq("event_id", eventId)
        .is("rsvped_at", null)
        .not("checked_in_at", "is", null)
        .eq("source", "checkin")
        .select("student_id");
      if (deleteError) return fail(deleteError.message);
      if (!deleted || deleted.length === 0) {
        // RSVP'd (or legacy) row: only clear the attendance stamp. Never write
        // source='rsvp' (the old code fabricated RSVPs for walk-ins here) and
        // never touch rsvped_at.
        const { error: clearError } = await admin
          .from("event_attendance")
          .update({ checked_in_at: null })
          .eq("student_id", studentId)
          .eq("event_id", eventId);
        if (clearError) return fail(clearError.message);
      }
    }

    return NextResponse.json({
      ok: true,
      student_id: studentId,
      checked_in: b.checked_in,
    });
  });
}
