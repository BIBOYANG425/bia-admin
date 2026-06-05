// /api/admin/shipping/pack-requests
// GET — list pack requests with attached parcels, filterable by status (viewer+).
// Ported from bia-roommate (Phase-3 slice 5): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { PACK_REQUEST_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";

const STATUS_SET = new Set<string>(PACK_REQUEST_STATUS_VALUES);

export async function GET(request: Request) {
  return withRole("viewer", async () => {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    if (status && !STATUS_SET.has(status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    let q = admin
      .from("pack_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);

    const { data: requests, error } = await q;
    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }

    const ids = (requests ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return NextResponse.json([]);
    }

    const { data: links } = await admin
      .from("pack_request_parcels")
      .select("request_id, parcel_id")
      .in("request_id", ids);

    const parcelIds = Array.from(
      new Set((links ?? []).map((l) => l.parcel_id)),
    );
    const { data: parcels } = parcelIds.length
      ? await admin
          .from("parcels")
          .select(
            "id, member_id, description, status, shipping_method, weight_grams, photos",
          )
          .in("id", parcelIds)
      : { data: [] };

    const parcelById = new Map((parcels ?? []).map((p) => [p.id, p]));
    const parcelsByRequest = new Map<string, unknown[]>();
    for (const link of links ?? []) {
      const p = parcelById.get(link.parcel_id);
      if (!p) continue;
      if (!parcelsByRequest.has(link.request_id)) {
        parcelsByRequest.set(link.request_id, []);
      }
      parcelsByRequest.get(link.request_id)!.push(p);
    }

    const result = (requests ?? []).map((r) => ({
      ...r,
      parcels: parcelsByRequest.get(r.id) ?? [],
    }));

    return NextResponse.json(result);
  });
}
