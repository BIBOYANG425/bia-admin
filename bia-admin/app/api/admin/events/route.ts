// /api/admin/events
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
