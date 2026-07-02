// /api/admin/shipping/shipments/[id]
// GET   — shipment + attached parcels (viewer+)
// PATCH — status, carrier, tracking, dates, pickup fields, notes (editor+)
// Ported from bia-roommate (Phase-3 slice 4): adminHandler -> withRole.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { SHIPMENT_STATUS_VALUES } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";
import {
  checkTransition,
  SHIPMENT_TRANSITION,
} from "@/lib/shipping/transitions";
import {
  enqueueShippingNotifications,
  type ShippingNotificationRow,
} from "@/lib/shipping/notify";

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
  return withRole("editor", async (auth) => {
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

    // Block status regressions / leaving a terminal state (transition policy).
    if (typeof patch.status === "string") {
      const { data: cur } = await admin
        .from("shipments")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (!cur) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const t = checkTransition(
        SHIPMENT_TRANSITION,
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

      // archived is terminal with no branch escape — a batch archived while
      // parcels are still live (not picked_up/lost/returned) strands them
      // forever: pickup can never re-open and the students' status hint stays
      // "到了，等 BIA 安排取件". Refuse until every parcel is settled (SR-1).
      if (patch.status === "archived") {
        const { count, error: activeErr } = await admin
          .from("parcels")
          .select("id", { count: "exact", head: true })
          .eq("shipment_id", id)
          .not("status", "in", "(picked_up,lost,returned)");
        if (activeErr) {
          return NextResponse.json(
            { error: "lookup_failed", details: activeErr.message },
            { status: 500 },
          );
        }
        if ((count ?? 0) > 0) {
          return NextResponse.json(
            {
              error: "shipment_has_active_parcels",
              detail: `还有 ${count} 个包裹未完成（未取件/未标记丢失或退回），不能归档`,
              active: count,
            },
            { status: 409 },
          );
        }
      }
    }

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

    // When pickup opens, enqueue pickup_open (+ pickup_reminder) per attached,
    // arrived parcel/student. App-layer (not a DB trigger) so a notification
    // hiccup never aborts the officer's shipment update; idempotent via
    // dedup_key. Nothing is sent here — the (gated) george consumer drains it.
    if (data.status === "pickup_open" && data.pickup_location && data.pickup_ends_at) {
      const { data: parcels } = await admin
        .from("parcels")
        .select("id, student_id, member_id")
        .eq("shipment_id", id)
        .eq("status", "arrived_us")
        .not("student_id", "is", null);

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const endsMs = new Date(data.pickup_ends_at).getTime();
      const reminderAt =
        Number.isFinite(endsMs) && endsMs > nowMs
          ? new Date(Math.max(nowMs, endsMs - 24 * 60 * 60 * 1000)).toISOString()
          : null;

      const rows: ShippingNotificationRow[] = [];
      for (const p of parcels ?? []) {
        if (!p.student_id) continue;
        const payload = {
          member_id: p.member_id,
          pickup_location: data.pickup_location,
          pickup_starts_at: data.pickup_starts_at,
          pickup_ends_at: data.pickup_ends_at,
        };
        rows.push({
          student_id: p.student_id,
          parcel_id: p.id,
          kind: "pickup_open",
          dedup_key: `${p.id}:pickup_open`,
          payload,
          status: "pending",
          scheduled_for: nowIso,
        });
        if (reminderAt) {
          rows.push({
            student_id: p.student_id,
            parcel_id: p.id,
            kind: "pickup_reminder",
            dedup_key: `${p.id}:pickup_reminder`,
            payload,
            status: "pending",
            scheduled_for: reminderAt,
          });
        }
      }
      await enqueueShippingNotifications(admin, rows);
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "shipment.update",
      entity_type: "shipment",
      entity_id: id,
      payload: { fields: Object.keys(patch), status: data.status },
    });

    return NextResponse.json(data);
  });
}
