// /api/admin/events/[id]
// GET   — event detail + attendance (rsvp/checkin list) (viewer+).
// PATCH — edit event fields incl. status (editor+).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const EVENT_STATUS = new Set(["active", "cancelled", "past"]);

const PatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    location: z.string().max(300).nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    capacity: z.number().int().positive().nullable().optional(),
    image_url: z.string().max(1000).nullable().optional(),
    source_url: z.string().max(1000).nullable().optional(),
    status: z.string().optional(),
  })
  .strip();

export async function GET(_request: Request, ctx: RouteContext) {
  return withRole("viewer", async () => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();
    const { data: event, error } = await admin
      .from("events")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }
    if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { data: attendance } = await admin
      .from("event_attendance")
      .select("source, created_at, students(id, name, member_id)")
      .eq("event_id", id)
      .order("created_at", { ascending: true });

    return NextResponse.json({ event, attendance: attendance ?? [] });
  });
}

export async function PATCH(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = PatchBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const b = parsed.data;
    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) patch.title = b.title.trim();
    if (b.description !== undefined) patch.description = b.description?.trim() || null;
    if (b.date !== undefined) patch.date = b.date || null;
    if (b.end_date !== undefined) patch.end_date = b.end_date || null;
    if (b.location !== undefined) patch.location = b.location?.trim() || null;
    if (b.category !== undefined) patch.category = b.category?.trim() || null;
    if (b.capacity !== undefined) patch.capacity = b.capacity ?? null;
    if (b.image_url !== undefined) patch.image_url = b.image_url?.trim() || null;
    if (b.source_url !== undefined) patch.source_url = b.source_url?.trim() || null;
    if (b.status !== undefined) {
      if (!EVENT_STATUS.has(b.status)) {
        return NextResponse.json({ error: "invalid_status" }, { status: 400 });
      }
      patch.status = b.status;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("events")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      return NextResponse.json(
        { error: "update_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "event.update",
      entity_type: "event",
      entity_id: id,
      payload: { fields: Object.keys(patch) },
    });

    return NextResponse.json(data);
  });
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    // Remove attendance first in case the FK isn't ON DELETE CASCADE.
    await admin.from("event_attendance").delete().eq("event_id", id);
    const { error } = await admin.from("events").delete().eq("id", id);
    if (error) {
      return NextResponse.json(
        { error: "delete_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "event.delete",
      entity_type: "event",
      entity_id: id,
      payload: {},
    });

    return NextResponse.json({ ok: true });
  });
}
