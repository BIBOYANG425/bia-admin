// App-layer shipping-notification enqueue (server-only, service-role).
//
// Pickup is a shipment-level concept, so pickup_open / pickup_reminder can't be
// produced by the parcel AFTER-UPDATE trigger alone. We enqueue them here, from
// the admin shipment route, when an officer opens pickup (the trigger covers
// late arrivals — parcels that reach arrived_us while the window is already
// open; see migration 20260703000004).
//
// Dedup keys for pickup kinds carry a WINDOW discriminator so a closed-and-
// reopened window can notify again:
//     <parcel_id>:<kind>:<shipment_id>:<epoch(pickup_starts_at)|na>
// (epoch seconds — format-stable between this file and the SQL trigger.)
// Status kinds stay '<parcel_id>:<kind>' (lifetime-once by design).
//
// refreshPending: a re-PATCH while pickup is open (reschedule, location edit,
// window reopen) first DELETEs this batch's still-pending pickup rows — any
// key, so stale old-window rows go too — then inserts fresh ones. Sent rows
// are never touched, so nothing is double-delivered.
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

/** Window discriminator shared with the SQL trigger — keep formats in sync. */
export function pickupWindowKey(
  parcelId: string,
  kind: "pickup_open" | "pickup_reminder",
  shipmentId: string,
  pickupStartsAt: string | null,
): string {
  const epoch = pickupStartsAt
    ? String(Math.floor(new Date(pickupStartsAt).getTime() / 1000))
    : "na";
  return `${parcelId}:${kind}:${shipmentId}:${epoch}`;
}

export async function enqueueShippingNotifications(
  admin: SupabaseClient,
  rows: ShippingNotificationRow[],
  opts?: { refreshPending?: boolean },
): Promise<void> {
  if (rows.length === 0) return;
  try {
    if (opts?.refreshPending) {
      const parcelIds = [...new Set(rows.map((r) => r.parcel_id))];
      const kinds = [...new Set(rows.map((r) => r.kind))];
      const { error: delError } = await admin
        .from("shipping_notifications")
        .delete()
        .in("parcel_id", parcelIds)
        .in("kind", kinds)
        .eq("status", "pending");
      if (delError) {
        console.error(
          "[enqueueShippingNotifications] refresh delete",
          delError.message,
        );
      }
    }
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
