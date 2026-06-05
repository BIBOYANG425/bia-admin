// /api/admin/shipping/parcels
// GET — list parcels with filters (status, shipment_id, member_id, search).
// Role-gated (viewer+). Returns { parcels, total, limit, offset }.
// Ported from bia-roommate; auth rewritten adminHandler -> withRole, client
// createAdminSupabaseClient -> createBiaServiceRoleClient (Phase-3 slice 3a).

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { PARCEL_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";

const STATUS_SET = new Set<string>(PARCEL_STATUS_VALUES);

export async function GET(request: Request) {
  return withRole("viewer", async () => {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const shipmentId = searchParams.get("shipment_id");
    const memberId = searchParams.get("member_id");
    const search = (searchParams.get("search") ?? "").trim();
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

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
