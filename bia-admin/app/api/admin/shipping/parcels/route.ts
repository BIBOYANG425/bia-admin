// /api/admin/shipping/parcels
// GET  — list parcels with filters (status, shipment_id, member_id, search).
//        Role-gated (viewer+). Returns { parcels, total, limit, offset }.
// POST — officer-side create a parcel for a walk-in / un-pre-declared package
//        (member_id + description required; optional tracking_cn/carrier_cn;
//        status may be 'expected' or 'received_cn'). editor+. Audited.
// Ported from bia-roommate; auth rewritten adminHandler -> withRole, client
// createAdminSupabaseClient -> createBiaServiceRoleClient (Phase-3 slice 3a).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { PARCEL_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { sanitizeSearchTerm } from "@/lib/shipping/search-filter";

const STATUS_SET = new Set<string>(PARCEL_STATUS_VALUES);

// Officer-created parcels only start at a pre-international status — the rest of
// the flow (in_transit/arrived_us/picked_up + branch states) is reached via the
// normal attach / advance / transition machinery, not by raw creation.
const CREATE_STATUSES = ["expected", "received_cn"] as const;

const CreateParcelBody = z.object({
  member_id: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  tracking_cn: z.string().trim().max(120).optional(),
  carrier_cn: z.string().trim().max(120).optional(),
  status: z.enum(CREATE_STATUSES).optional(),
  weight_grams: z.number().int().min(0).nullable().optional(),
});

export async function GET(request: Request) {
  return withRole("viewer", async () => {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const shipmentId = searchParams.get("shipment_id");
    const memberId = searchParams.get("member_id");
    const search = sanitizeSearchTerm(searchParams.get("search"));
    // Validate pagination — NaN reaching PostgREST turns into a confusing 500.
    const rawLimit = Number(searchParams.get("limit") ?? 50);
    const rawOffset = Number(searchParams.get("offset") ?? 0);
    if (!Number.isFinite(rawLimit) || !Number.isFinite(rawOffset)) {
      return NextResponse.json({ error: "invalid_pagination" }, { status: 400 });
    }
    const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 200);
    const offset = Math.max(Math.floor(rawOffset), 0);

    if (status && !STATUS_SET.has(status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    let query = admin
      .from("parcels")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (shipmentId === "null") query = query.is("shipment_id", null);
    else if (shipmentId) query = query.eq("shipment_id", shipmentId);
    if (memberId) query = query.eq("member_id", memberId);
    if (search) {
      query = query.or(
        `description.ilike.%${search}%,tracking_cn.ilike.%${search}%,member_id.ilike.%${search}%`,
      );
    }

    const { data, count, error } = await query.range(offset, offset + limit - 1);
    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({
      parcels: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  });
}

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = CreateParcelBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { member_id, description, tracking_cn, carrier_cn, weight_grams } =
      parsed.data;
    const status = parsed.data.status ?? "expected";

    const insert: Record<string, unknown> = {
      member_id,
      description,
      status,
    };
    if (tracking_cn) insert.tracking_cn = tracking_cn;
    if (carrier_cn) insert.carrier_cn = carrier_cn;
    if (weight_grams != null) insert.weight_grams = weight_grams;
    // Stamp received_at when an officer logs an already-in-hand walk-in parcel.
    if (status === "received_cn") insert.received_at = new Date().toISOString();

    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("parcels")
      .insert(insert)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "create_failed", details: error.message },
        { status: 500 },
      );
    }

    // Seed the timeline: the status-change trigger only fires on UPDATE, so an
    // officer-created parcel otherwise starts with an empty/misleading
    // timeline (SR-5). Best-effort — creation already succeeded.
    const { error: evErr } = await admin.from("parcel_events").insert({
      parcel_id: data.id as string,
      from_status: null,
      to_status: status,
      actor_user_id: auth.user.id,
      actor_role: "admin",
      note: "运营创建（walk-in / 代录）",
    });
    if (evErr) console.error("[parcel.create] parcel_events", evErr.message);

    await writeAudit({
      admin_email: auth.user.email,
      action: "parcel.create",
      entity_type: "parcel",
      entity_id: data.id as string,
      payload: { member_id, status },
    });

    return NextResponse.json(data, { status: 201 });
  });
}
