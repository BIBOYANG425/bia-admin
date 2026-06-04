// /api/admin/shipping/shipments/[id]
// GET   — shipment + attached parcels (viewer+)
// PATCH — status, carrier, tracking, dates, pickup fields, notes (editor+)
// Ported from bia-roommate (Phase-3 slice 4): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { SHIPMENT_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const SHIPMENT_STATUS_SET = new Set<string>(SHIPMENT_STATUS_VALUES);

const PatchShipmentBody = z.object({
  name: z.string().max(200).optional(),
  status: z.string().optional(),
  carrier: z.union([z.string(), z.null()]).optional(),
  international_tracking: z.union([z.string(), z.null()]).optional(),
  departed_cn_at: z.union([z.string(), z.null()]).optional(),
  arrived_us_at: z.union([z.string(), z.null()]).optional(),
  pickup_location: z.union([z.string(), z.null()]).optional(),
  pickup_starts_at: z.union([z.string(), z.null()]).optional(),
  pickup_ends_at: z.union([z.string(), z.null()]).optional(),
  price_per_kg_cents: z.union([z.number(), z.null()]).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
});

export async function GET(_request: Request, ctx: RouteContext) {
  return withRole("viewer", async () => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const [{ data: shipment, error }, { data: parcels }] = await Promise.all([
      admin.from("shipments").select("*").eq("id", id).maybeSingle(),
      admin
        .from("parcels")
        .select("*")
        .eq("shipment_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }
    if (!shipment) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ shipment, parcels: parcels ?? [] });
  });
}

export async function PATCH(request: Request, ctx: RouteContext) {
  return withRole("editor", async () => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = PatchShipmentBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        patch[key] = value === "" ? null : value;
      }
    }

    if (
      typeof patch.status === "string" &&
      !SHIPMENT_STATUS_SET.has(patch.status)
    ) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("shipments")
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
    return NextResponse.json(data);
  });
}
