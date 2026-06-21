// App-layer shipping-notification enqueue (server-only, service-role).
//
// Pickup is a shipment-level concept, so pickup_open / pickup_reminder can't be
// produced by the parcel AFTER-UPDATE trigger. We enqueue them here, from the
// admin shipment route, when an officer opens pickup. Mirrors the trigger's
// insert shape (student_id, parcel_id, kind, dedup_key, payload, status,
// scheduled_for) + ON CONFLICT (dedup_key) DO NOTHING for idempotency.
//
// IMPORTANT: enqueue failures must never break the officer's action — we log
// and swallow (same philosophy as writeAudit). Nothing is *sent* here; the
// george consumer drains the queue (and is gated off until go-live).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ShippingNotificationRow {
  student_id: string;
  parcel_id: string;
  kind: string;
  dedup_key: string;
  payload: Record<string, unknown>;
  status: "pending";
  scheduled_for: string;
}

export async function enqueueShippingNotifications(
  admin: SupabaseClient,
  rows: ShippingNotificationRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await admin
      .from("shipping_notifications")
      .upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
    if (error) {
      console.error("[enqueueShippingNotifications]", error.message);
    }
  } catch (err) {
    console.error("[enqueueShippingNotifications] threw", err);
  }
}
