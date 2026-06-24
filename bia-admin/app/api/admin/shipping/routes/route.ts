// /api/admin/shipping/routes
// GET   — list all routes incl. inactive (viewer+)
// PATCH — update a route by id (price, dates, notes, label, active); `method`
//         is intentionally NOT patchable (retire via active=false). editor+.
// Ported from bia-roommate /api/shipping/admin/routes (Phase-3 slice 7):
// requireAdmin -> withRole, createAdminSupabaseClient -> createBiaServiceRoleClient.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

export async function GET() {
  return withRole("viewer", async () => {
    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("shipping_routes")
      .select("*")
      .order("method");

    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json(data ?? []);
  });
}

export async function PATCH(request: Request) {
  return withRole("editor", async (auth) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "id_required" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (body.price_per_kg_cny !== undefined) {
      const v = body.price_per_kg_cny;
      patch.price_per_kg_cny = v === null ? null : Number(v);
    }
    if (body.next_departure_date !== undefined) {
      patch.next_departure_date = body.next_departure_date || null;
    }
    if (body.estimated_arrival_date !== undefined) {
      patch.estimated_arrival_date = body.estimated_arrival_date || null;
    }
    if (body.transit_days_estimate !== undefined) {
      const v = body.transit_days_estimate;
      patch.transit_days_estimate = v === null ? null : Number(v);
    }
    if (typeof body.cutoff_note === "string" || body.cutoff_note === null) {
      patch.cutoff_note = body.cutoff_note || null;
    }
    if (typeof body.notes === "string" || body.notes === null) {
      patch.notes = body.notes || null;
    }
    if (typeof body.label === "string") {
      patch.label = body.label;
    }
    if (body.frequency_label !== undefined) {
      patch.frequency_label =
        typeof body.frequency_label === "string"
          ? body.frequency_label.trim() || null
          : null;
    }
    if (typeof body.active === "boolean") {
      patch.active = body.active;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("shipping_routes")
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
      action: "shipping_route.update",
      entity_type: "shipping_route",
      entity_id: id,
      payload: { id, fields: Object.keys(patch) },
    });

    return NextResponse.json(data);
  });
}
