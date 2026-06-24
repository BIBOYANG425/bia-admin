// /api/admin/events/[id]/export
// GET — stream the event's attendance roster as CSV (viewer+). For flagship
// events (300–500+ attendees) officers need the list out for follow-up.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(_request: Request, ctx: RouteContext) {
  return withRole("viewer", async () => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const { data: rows, error } = await admin
      .from("event_attendance")
      .select("source, created_at, students(name, member_id)")
      .eq("event_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }

    const header = ["姓名", "Member ID", "状态", "时间"];
    // supabase-js types the to-one `students` embed pessimistically as an array;
    // at runtime it is a single object (many-to-one FK). Cast through unknown.
    const body = ((rows ?? []) as unknown as Array<{
      source: string;
      created_at: string;
      students: { name: string | null; member_id: string | null } | null;
    }>).map((r) => [
      r.students?.name ?? "",
      r.students?.member_id ?? "",
      r.source === "checkin" ? "已签到" : "报名",
      r.created_at,
    ]);

    const BOM = String.fromCharCode(0xfeff);
    const csv =
      BOM +
      [header, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="roster-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
