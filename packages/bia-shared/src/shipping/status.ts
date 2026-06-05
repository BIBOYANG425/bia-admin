/* ── Shipping status-flow helpers ───────────────────────────────────────────
 * Happy-path steppers + "what status comes next" for the admin UI. Branch
 * statuses (lost/returned/disputed) render off-path on the stepper. Ported
 * from bia-roommate/lib/admin/{parcel-status,shipment-status}.ts (slice 1).
 * ────────────────────────────────────────────────────────────────────────── */

import type { ParcelStatus, ShipmentStatus } from "./types";

/** Ordered happy-path parcel statuses, used by StatusProgress. */
export const PARCEL_STEPS: ParcelStatus[] = [
  "expected",
  "received_cn",
  "in_transit",
  "arrived_us",
  "picked_up",
];

/** Branch statuses — end states that are not part of the main stepper. */
export const PARCEL_BRANCH_STATUSES: ParcelStatus[] = [
  "lost",
  "returned",
  "disputed",
];

/** Status the admin would typically bump to next on the happy path. */
export function nextParcelStatus(current: ParcelStatus): ParcelStatus | null {
  const idx = PARCEL_STEPS.indexOf(current);
  if (idx < 0 || idx >= PARCEL_STEPS.length - 1) return null;
  return PARCEL_STEPS[idx + 1];
}

/** Ordered shipment lifecycle, used by StatusProgress. */
export const SHIPMENT_STEPS: ShipmentStatus[] = [
  "forming",
  "sealed",
  "departed_cn",
  "customs",
  "arrived_us",
  "pickup_open",
  "pickup_closed",
  "archived",
];

export function nextShipmentStatus(
  current: ShipmentStatus,
): ShipmentStatus | null {
  const idx = SHIPMENT_STEPS.indexOf(current);
  if (idx < 0 || idx >= SHIPMENT_STEPS.length - 1) return null;
  return SHIPMENT_STEPS[idx + 1];
}
