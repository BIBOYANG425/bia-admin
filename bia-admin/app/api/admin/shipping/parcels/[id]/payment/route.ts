// /api/admin/shipping/parcels/[id]/payment
// PATCH — record offline payment reconciliation on a parcel (editor+).
// Plain parcels UPDATE (NOT admin_patch_parcel) — these are bookkeeping fields,
// not a status transition, so they intentionally write NO parcel_events row.
// This is the money trail, so the audit payload carries BOTH prior and new
// values (SR-5): an undo no longer erases who/when/how without a durable
// record, and an amount change is reconstructable as from→to.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Body = z.object({
  amount_owed_cents: z.number().int().min(0).nullable().optional(),
  paid: z.boolean().optional(),
  paid_method: z.enum(["cash", "transfer", "other"]).nullable().optional(),
  paid_note: z.string().max(500).nullable().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const admin = createBiaServiceRoleClient();

    // Read the prior money state first — it goes into the audit payload.
    const { data: prior, error: priorErr } = await admin
      .from("parcels")
      .select("id, amount_owed_cents, paid_at, paid_by_admin, paid_method, paid_note")
      .eq("id", id)
      .maybeSingle();
    if (priorErr) {
      return NextResponse.json(
        { error: "lookup_failed", details: priorErr.message },
        { status: 500 },
      );
    }
    if (!prior) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    if (body.amount_owed_cents !== undefined)
      patch.amount_owed_cents = body.amount_owed_cents;
    if (body.paid_note !== undefined) patch.paid_note = body.paid_note;

    if (body.paid !== undefined) {
      if (body.paid) {
        patch.paid_at = new Date().toISOString();
        patch.paid_by_admin = auth.user.email;
        // method defaults to 'cash' when marking paid without specifying.
        patch.paid_method = body.paid_method ?? "cash";
      } else {
        patch.paid_at = null;
        patch.paid_by_admin = null;
        patch.paid_method = null;
        // An un-mark clears the whole reconciliation record — a note about a
        // payment that no longer exists would orphan on the unpaid parcel.
        // The prior note survives in the audit payload below.
        if (body.paid_note === undefined) patch.paid_note = null;
      }
    } else if (body.paid_method !== undefined) {
      patch.paid_method = body.paid_method;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("parcels")
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
      action: "parcel.payment_update",
      entity_type: "parcel",
      entity_id: id,
      payload: {
        prior: {
          amount_owed_cents: prior.amount_owed_cents,
          paid_at: prior.paid_at,
          paid_by_admin: prior.paid_by_admin,
          paid_method: prior.paid_method,
          paid_note: prior.paid_note,
        },
        next: {
          amount_owed_cents: data.amount_owed_cents,
          paid_at: data.paid_at,
          paid_by_admin: data.paid_by_admin,
          paid_method: data.paid_method,
          paid_note: data.paid_note,
        },
      },
    });

    return NextResponse.json(data);
  });
}
