// /api/admin/shipping/parcels/bulk-receive
// POST { items: [{ id, weight_grams? }] } — bulk-advance 'expected' parcels to
// 'received_cn' (stamping received_at + optional weight) via admin_patch_parcel
// so the parcel_events audit chain is preserved. editor+. Forward-only: only
// 'expected' parcels are received; anything else is skipped (idempotent re-run,
// no backward moves). Takes an explicit id list — never "all matching a query".

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const Body = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        weight_grams: z.number().int().min(0).nullable().optional(),
      }),
    )
    .min(1)
    .max(300),
});

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = createBiaServiceRoleClient();
    const ids = parsed.data.items.map((i) => i.id);

    // Forward-only guard: re-read live status; only 'expected' parcels receive.
    const { data: existing, error } = await admin
      .from("parcels")
      .select("id, status")
      .in("id", ids);
    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }
    const statusById = new Map<string, string>(
      (existing ?? []).map((p) => [p.id as string, p.status as string]),
    );

    const nowIso = new Date().toISOString();
    let updated = 0;
    let skipped = 0;
    const failed: string[] = [];

    // Sequential: admin_patch_parcel sets per-transaction actor GUCs on the
    // pooled connection, so concurrent calls would clobber each other.
    for (const item of parsed.data.items) {
      if (statusById.get(item.id) !== "expected") {
        skipped++;
        continue;
      }
      const patch: Record<string, unknown> = {
        status: "received_cn",
        received_at: nowIso,
      };
      if (item.weight_grams != null) patch.weight_grams = item.weight_grams;

      const { error: rpcErr } = await admin.rpc("admin_patch_parcel", {
        p_id: item.id,
        p_actor_user_id: auth.user.id,
        p_patch: patch,
      });
      if (rpcErr) {
        failed.push(item.id);
        continue;
      }
      updated++;
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "parcel.bulk_receive",
      entity_type: "parcel",
      entity_id: null,
      payload: {
        count: parsed.data.items.length,
        updated,
        skipped,
        failed: failed.length,
      },
    });

    return NextResponse.json({
      updated,
      skipped,
      failed: failed.length,
      total: parsed.data.items.length,
    });
  });
}
