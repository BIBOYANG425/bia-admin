// Admin event detail — async server component. Queries the event + attendance
// roster directly (formerly via the deleted single-consumer GET
// /api/admin/events/[id]); renders EventEditor (PATCH flow), a DeleteEventButton
// (super_admin), and the CheckinRoster client island. Check-ins POST to
// /api/admin/events/[id]/checkin then router.refresh(). Role comes from
// requireRole; the write APIs re-enforce it. Roster time output stays en-US.

import Link from "next/link";
import { notFound } from "next/navigation";
import { roleAtLeast } from "@biboyang425/bia-shared";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import { requireRole } from "@/lib/auth/require-role";
import { EventEditor, type EventRecord } from "../EventEditor";
import { CheckinRoster, type AttendanceRow } from "./CheckinRoster";
import { DeleteEventButton } from "./DeleteEventButton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminEventDetailPage({ params }: PageProps) {
  const { role } = await requireRole("viewer");
  const { id } = await params;
  const canWrite = roleAtLeast(role, "editor");
  const canDelete = roleAtLeast(role, "super_admin");

  const admin = createBiaServiceRoleClient();
  const { data: event, error } = await admin
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load event: ${error.message}`);
  }
  if (!event) notFound();

  const { data: attendance } = await admin
    .from("event_attendance")
    .select("source, created_at, students(id, name, member_id)")
    .eq("event_id", id)
    .order("created_at", { ascending: true });

  const rows = (attendance ?? []) as unknown as AttendanceRow[];

  return (
    <div className="p-8 space-y-6">
      <Link
        href="/admin/events"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← 活动
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
        {canDelete && <DeleteEventButton eventId={id} />}
      </div>

      <EventEditor event={event as EventRecord} eventId={id} />

      <CheckinRoster eventId={id} attendance={rows} canWrite={canWrite} />
    </div>
  );
}
