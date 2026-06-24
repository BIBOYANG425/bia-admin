// /api/admin/shipping/shipments
// GET  — list shipments (filter by status; viewer+)
// POST — create { name, carrier?, notes? }; status defaults to 'forming' (editor+)
// Ported from bia-roommate (Phase-3 slice 4): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { SHIPMENT_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const SHIPMENT_STATUS_SET = new Set<string>(SHIPMENT_STATUS_VALUES);

const CreateShipmentBody = z.object({
  name: z.string().min(1).max(200),
  carrier: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(request: Request) {
  return withRole("viewer", async () => {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    if (status && !SHIPMENT_STATUS_SET.has(status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    let query = admin
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json(data ?? []);
  });
}

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = CreateShipmentBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const name = parsed.data.name.trim();
    if (!name) {
      return NextResponse.json({ error: "name_required" }, { status: 400 });
    }
    const carrier = parsed.data.carrier?.trim() || null;
    const notes = parsed.data.notes?.trim() || null;

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("shipments")
      .insert({ name, carrier, notes, created_by: auth.user.id })
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
      action: "shipment.create",
      entity_type: "shipment",
      entity_id: data.id,
      payload: { name, carrier, status: data.status },
    });

    return NextResponse.json(data, { status: 201 });
  });
}
