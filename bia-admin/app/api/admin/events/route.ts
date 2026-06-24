// /api/admin/events
// GET  — list events (all statuses) + rsvp_count (viewer+).
// POST — create a BIA-curated event (editor+).
// events / event_attendance are george-owned; bia-admin reads/writes via
// service-role (the admin app — service-role is correct here, unlike roommate).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const CreateBody = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    location: z.string().max(300).nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    capacity: z.number().int().positive().nullable().optional(),
    image_url: z.string().max(1000).nullable().optional(),
    source_url: z.string().max(1000).nullable().optional(),
  })
  .strip();

export async function GET() {
  return withRole("viewer", async () => {
    const admin = createBiaServiceRoleClient();
    const { data: events, error } = await admin
      .from("events")
      .select(
        "id, title, date, end_date, location, category, source, status, capacity, created_at",
      )
      .order("date", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }

    const ids = (events ?? []).map((e) => e.id as string);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      // Registered = RSVP'd OR checked in (check-in overwrites source
      // rsvp→checkin, so counting only 'rsvp' undercounts). Matches the
      // events list page.
      const { data: att } = await admin
        .from("event_attendance")
        .select("event_id")
        .in("source", ["rsvp", "checkin"])
        .in("event_id", ids);
      for (const a of att ?? []) {
        const k = a.event_id as string;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }

    const out = (events ?? []).map((e) => ({
      ...e,
      rsvp_count: counts.get(e.id as string) ?? 0,
    }));
    return NextResponse.json(out);
  });
}

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = CreateBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const b = parsed.data;
    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("events")
      .insert({
        title: b.title.trim(),
        description: b.description?.trim() || null,
        date: b.date || null,
        end_date: b.end_date || null,
        location: b.location?.trim() || null,
        category: b.category?.trim() || null,
        capacity: b.capacity ?? null,
        image_url: b.image_url?.trim() || null,
        source_url: b.source_url?.trim() || null,
        source: "bia",
        status: "active",
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json(
        { error: "create_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "event.create",
      entity_type: "event",
      entity_id: (data?.id as string) ?? null,
      payload: { title: b.title.trim() },
    });

    return NextResponse.json(data);
  });
}
