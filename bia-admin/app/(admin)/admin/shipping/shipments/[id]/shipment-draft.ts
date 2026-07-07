// Pure draft + diff helpers for the shipment editor.
//
// Replaces the 11 parallel per-field draft `useState`s + the hand-written
// per-field diff that used to live in the shipment detail page. A single
// `ShipmentDraft` object holds every editable field as the string its input
// produces; `diffShipmentDraft` compares it against the loaded `Shipment` and
// emits ONLY changed fields, in the same key order the old `saveAll` used, so
// the PATCH payload is byte-for-byte identical to before.
//
// Field kinds encode the exact "" ↔ null behaviour of the original:
//   text     — cleared input sends "" (NOT null), compared against `s[key] ?? ""`.
//   datetime — datetime-local string; `fromLocalInput` maps it to ISO|null
//              (cleared → null); compared against the raw ISO on the shipment.
//   number   — numeric string; compared on its STRING form (so "0500" vs stored
//              500 counts as a change) and emitted as null (when "") | Number.
//
// No React here on purpose: this is the regression-risk surface, unit-tested in
// __tests__/shipment-draft.test.ts.
//
// Header last reviewed: 2026-07-07

import type { Shipment, ShipmentStatus } from "@biboyang425/bia-shared/shipping";

export interface ShipmentDraft {
  name: string;
  status: ShipmentStatus;
  carrier: string;
  international_tracking: string;
  departed_cn_at: string;
  arrived_us_at: string;
  pickup_location: string;
  pickup_starts_at: string;
  pickup_ends_at: string;
  price_per_kg_cents: string;
  notes: string;
}

/** ISO string → value for a `datetime-local` input (local tz, minute precision). */
export function toLocalInput(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

/** `datetime-local` input value → ISO string, or null when empty. */
export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

/** Seed a draft from the loaded shipment (matches the old per-field seeding). */
export function draftFromShipment(s: Shipment): ShipmentDraft {
  return {
    name: s.name,
    status: s.status,
    carrier: s.carrier ?? "",
    international_tracking: s.international_tracking ?? "",
    departed_cn_at: toLocalInput(s.departed_cn_at),
    arrived_us_at: toLocalInput(s.arrived_us_at),
    pickup_location: s.pickup_location ?? "",
    pickup_starts_at: toLocalInput(s.pickup_starts_at),
    pickup_ends_at: toLocalInput(s.pickup_ends_at),
    price_per_kg_cents:
      s.price_per_kg_cents !== null ? String(s.price_per_kg_cents) : "",
    notes: s.notes ?? "",
  };
}

type FieldKind = "text" | "datetime" | "number";

// Ordered exactly as the old `saveAll` inserted keys, so JSON.stringify(patch)
// is byte-identical. Draft field names == shipment field names == patch keys.
const FIELDS: ReadonlyArray<{ key: keyof ShipmentDraft; kind: FieldKind }> = [
  { key: "name", kind: "text" },
  { key: "status", kind: "text" },
  { key: "carrier", kind: "text" },
  { key: "international_tracking", kind: "text" },
  { key: "departed_cn_at", kind: "datetime" },
  { key: "arrived_us_at", kind: "datetime" },
  { key: "pickup_location", kind: "text" },
  { key: "pickup_starts_at", kind: "datetime" },
  { key: "pickup_ends_at", kind: "datetime" },
  { key: "price_per_kg_cents", kind: "number" },
  { key: "notes", kind: "text" },
];

/**
 * Generic diff of a draft against the loaded shipment. Emits only fields whose
 * value changed, preserving the original per-field "" ↔ null / number semantics.
 */
export function diffShipmentDraft(
  draft: ShipmentDraft,
  shipment: Shipment,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const s = shipment as unknown as Record<string, unknown>;

  for (const { key, kind } of FIELDS) {
    const draftVal = draft[key] as string;

    if (kind === "text") {
      const base = (s[key] as string | null) ?? "";
      if (draftVal !== base) patch[key] = draftVal;
    } else if (kind === "datetime") {
      const base = s[key] as string | null;
      const next = fromLocalInput(draftVal);
      if (next !== base) patch[key] = next;
    } else {
      const rawNum = s[key] as number | null;
      const base = rawNum !== null ? String(rawNum) : "";
      if (draftVal !== base) {
        patch[key] = draftVal === "" ? null : Number(draftVal);
      }
    }
  }

  return patch;
}
