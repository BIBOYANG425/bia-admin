// POST /api/admin/events/[id]/checkin — mark a student attended (or undo) (editor+).
// body: { student_id?: string, member_id?: string, checked_in: boolean }
//
// One row per (student, event); source tracks the latest touchpoint —
// 'rsvp' = registered, 'checkin' = attended. Checking in flips rsvp→checkin
// (upsert ON CONFLICT DO UPDATE); a member_id walk-in inserts a checkin row.

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

    const source = b.checked_in ? "checkin" : "rsvp";
    const { error } = await admin
      .from("event_attendance")
      .upsert(
        { student_id: studentId, event_id: eventId, source },
        { onConflict: "student_id,event_id" },
      );
    if (error) {
      return NextResponse.json(
        { error: "checkin_failed", details: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, student_id: studentId, source });
  });
}
