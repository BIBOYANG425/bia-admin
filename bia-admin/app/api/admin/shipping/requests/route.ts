// /api/admin/shipping/requests
// GET — list shipment requests, filter by status (viewer+).
// Ported from bia-roommate (Phase-3 slice 6): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { SHIPMENT_REQUEST_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";

const STATUS_SET = new Set<string>(SHIPMENT_REQUEST_STATUS_VALUES);

export async function GET(request: Request) {
  return withRole("viewer", async () => {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    if (status && !STATUS_SET.has(status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    // Bounded fetch — never unbounded as history grows.
    let query = admin
      .from("shipment_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
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
