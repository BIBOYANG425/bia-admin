// /api/admin/shipping/parcels/[id]
// GET   — full parcel + events + shipment (viewer+)
// PATCH — status / weight / dims / notes / received_at / shipment_id via
//         admin_patch_parcel RPC (editor+). The RPC sets actor GUCs so the
//         DB-side parcel_events log stamps actor_role='admin' — passing
//         p_actor_user_id: auth.user.id keeps that cross-app audit chain intact.
// Ported from bia-roommate (Phase-3 slice 3a). writeAudit intentionally
// deferred: admin_audit_log.entity_type has no 'parcel' value yet (DB change).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { PARCEL_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";
import {
  checkTransition,
  PARCEL_TRANSITION,
} from "@/lib/shipping/transitions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const STATUS_SET = new Set<string>(PARCEL_STATUS_VALUES);

// Shape + max-length only; status/enum validation stays in the handler.
const PatchParcelBody = z.object({
  status: z.string().optional(),
  weight_grams: z.number().nullable().optional(),
  dim_cm_l: z.number().nullable().optional(),
  dim_cm_w: z.number().nullable().optional(),
  dim_cm_h: z.number().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  received_at: z.string().nullable().optional(),
  shipment_id: z.string().nullable().optional(),
});

export async function GET(_request: Request, ctx: RouteContext) {
  return withRole("viewer", async () => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const { data: parcel, error } = await admin
      .from("parcels")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }
    if (!parcel) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const [{ data: events }, { data: shipment }] = await Promise.all([
      admin
        .from("parcel_events")
        .select("*")
        .eq("parcel_id", id)
        .order("created_at", { ascending: false }),
      parcel.shipment_id
        ? admin
            .from("shipments")
            .select("*")
            .eq("id", parcel.shipment_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // Sign private-bucket photo paths server-side (service-role bypasses RLS).
    let photoUrls: string[] = [];
    const paths: string[] = parcel.photos ?? [];
    if (paths.length > 0) {
      const { data: signed } = await admin.storage
        .from("parcel-photos")
        .createSignedUrls(paths, 60 * 60);
      photoUrls = (signed ?? [])
        .map((s) => s.signedUrl ?? "")
        .filter((u) => u.length > 0);
    }

    return NextResponse.json({
      parcel,
      events: events ?? [],
      shipment: shipment ?? null,
      photoUrls,
    });
  });
}

export async function PATCH(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = PatchParcelBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Build patch from defined keys only.
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }
    if (typeof patch.status === "string" && !STATUS_SET.has(patch.status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();

    // Block status regressions / leaving a terminal state (transition policy).
    // The other admin_patch_parcel callers (advance-parcels, bulk-receive) only
    // ever move parcels forward, so guarding this editor-facing PATCH is enough.
    if (typeof patch.status === "string") {
      const { data: cur } = await admin
        .from("parcels")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (!cur) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const t = checkTransition(
        PARCEL_TRANSITION,
        cur.status as string,
        patch.status,
      );
      if (!t.ok) {
        return NextResponse.json(
          {
            error: "invalid_transition",
            detail: t.reason,
            from: cur.status,
            to: patch.status,
          },
          { status: 409 },
        );
      }
    }

    const { data, error } = await admin.rpc("admin_patch_parcel", {
      p_id: id,
      p_actor_user_id: auth.user.id,
      p_patch: patch,
    });

    if (error) {
      return NextResponse.json(
        { error: "update_failed", details: error.message },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(data);
  });
}
