// /api/admin/shipping/routes
// GET   — list all routes incl. inactive (viewer+)
// PATCH — update a route by id (price, dates, notes, label, active); `method`
//         is intentionally NOT patchable (retire via active=false). editor+.
// SR-8: zod-validated (was the last hand-rolled mutation body — Number() let
// NaN through to public-site-visible pricing). SR-5: audit carries old→new
// values, not just field names — route pricing is public-facing money.

import { NextResponse } from "next/server";
import { z } from "zod";
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The admin page sends numeric inputs as strings ("12.5") — coerce, but keep
// null distinct (z.coerce alone would turn null into 0). NaN fails validation
// instead of reaching PostgREST.
const nullableNumber = (inner: z.ZodNumber) => z.union([z.null(), inner]);

const PatchRouteBody = z.object({
  id: z.string().trim().min(1),
  price_per_kg_cny: nullableNumber(
    z.coerce.number().min(0).max(100000),
  ).optional(),
  next_departure_date: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .nullable()
    .optional(),
  estimated_arrival_date: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .nullable()
    .optional(),
  transit_days_estimate: nullableNumber(
    z.coerce.number().int().min(0).max(365),
  ).optional(),
  cutoff_note: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  label: z.string().trim().min(1).max(120).optional(),
  frequency_label: z.string().max(120).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = PatchRouteBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { id, ...fields } = parsed.data;

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      patch[key] = typeof value === "string" && value.trim() === "" ? null : value;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();

    // Prior values for the audit trail (public-facing pricing/dates).
    const { data: prior } = await admin
      .from("shipping_routes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!prior) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

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

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(patch)) {
      changes[key] = {
        from: (prior as Record<string, unknown>)[key],
        to: (data as Record<string, unknown>)[key],
      };
    }
    await writeAudit({
      admin_email: auth.user.email,
      action: "shipping_route.update",
      entity_type: "shipping_route",
      entity_id: id,
      payload: { id, changes },
    });

    return NextResponse.json(data);
  });
}
