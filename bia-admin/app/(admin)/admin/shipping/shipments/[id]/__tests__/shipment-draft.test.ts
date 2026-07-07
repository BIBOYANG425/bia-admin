import { describe, expect, it } from "vitest";
import type { Shipment } from "@biboyang425/bia-shared/shipping";
import {
  diffShipmentDraft,
  draftFromShipment,
  fromLocalInput,
  toLocalInput,
} from "../shipment-draft";

// Minimal shipment fixture — diff only reads the editable fields.
function makeShipment(over: Partial<Shipment> = {}): Shipment {
  return {
    id: "s1",
    name: "batch-1",
    status: "forming",
    carrier: null,
    international_tracking: null,
    departed_cn_at: null,
    arrived_us_at: null,
    pickup_location: null,
    pickup_starts_at: null,
    pickup_ends_at: null,
    price_per_kg_cents: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Shipment;
}

describe("draftFromShipment", () => {
  it("maps nulls to empty strings and stamps numeric/datetime forms", () => {
    const s = makeShipment({ price_per_kg_cents: 1200 });
    const draft = draftFromShipment(s);
    expect(draft.name).toBe("batch-1");
    expect(draft.status).toBe("forming");
    expect(draft.carrier).toBe("");
    expect(draft.international_tracking).toBe("");
    expect(draft.pickup_location).toBe("");
    expect(draft.notes).toBe("");
    expect(draft.departed_cn_at).toBe("");
    expect(draft.price_per_kg_cents).toBe("1200");
  });
});

describe("diffShipmentDraft — unchanged", () => {
  it("emits nothing when the draft equals the loaded shipment", () => {
    const s = makeShipment({
      carrier: "DHL",
      international_tracking: "TRK1",
      pickup_location: "THH 301",
      notes: "hi",
      price_per_kg_cents: 800,
      departed_cn_at: new Date(2026, 0, 15, 10, 30).toISOString(),
    });
    expect(diffShipmentDraft(draftFromShipment(s), s)).toEqual({});
  });
});

describe("diffShipmentDraft — text fields ('' kept, NOT normalized to null)", () => {
  it("clearing carrier sends '' (not null)", () => {
    const s = makeShipment({ carrier: "DHL" });
    const draft = { ...draftFromShipment(s), carrier: "" };
    expect(diffShipmentDraft(draft, s)).toEqual({ carrier: "" });
  });

  it("clearing notes/pickup_location/tracking each send ''", () => {
    const s = makeShipment({
      notes: "n",
      pickup_location: "loc",
      international_tracking: "trk",
    });
    const draft = {
      ...draftFromShipment(s),
      notes: "",
      pickup_location: "",
      international_tracking: "",
    };
    expect(diffShipmentDraft(draft, s)).toEqual({
      international_tracking: "",
      pickup_location: "",
      notes: "",
    });
  });

  it("editing name and status emits the raw new strings", () => {
    const s = makeShipment({ name: "old" });
    const draft = { ...draftFromShipment(s), name: "new", status: "sealed" as const };
    expect(diffShipmentDraft(draft, s)).toEqual({ name: "new", status: "sealed" });
  });
});

describe("diffShipmentDraft — datetime fields ('' -> null)", () => {
  it("setting a datetime from empty emits the ISO", () => {
    const s = makeShipment({});
    const iso = new Date(2026, 0, 15, 10, 30).toISOString();
    const draft = { ...draftFromShipment(s), departed_cn_at: toLocalInput(iso) };
    expect(diffShipmentDraft(draft, s)).toEqual({ departed_cn_at: iso });
  });

  it("clearing a datetime emits null", () => {
    const iso = new Date(2026, 0, 15, 10, 30).toISOString();
    const s = makeShipment({ pickup_starts_at: iso });
    const draft = { ...draftFromShipment(s), pickup_starts_at: "" };
    expect(diffShipmentDraft(draft, s)).toEqual({ pickup_starts_at: null });
  });
});

describe("diffShipmentDraft — number field (string-compare, emit null|Number)", () => {
  it("clearing price emits null", () => {
    const s = makeShipment({ price_per_kg_cents: 500 });
    const draft = { ...draftFromShipment(s), price_per_kg_cents: "" };
    expect(diffShipmentDraft(draft, s)).toEqual({ price_per_kg_cents: null });
  });

  it("setting price from empty emits a Number", () => {
    const s = makeShipment({ price_per_kg_cents: null });
    const draft = { ...draftFromShipment(s), price_per_kg_cents: "500" };
    expect(diffShipmentDraft(draft, s)).toEqual({ price_per_kg_cents: 500 });
  });

  it("equal numeric string is not a change", () => {
    const s = makeShipment({ price_per_kg_cents: 500 });
    expect(diffShipmentDraft(draftFromShipment(s), s)).toEqual({});
  });

  it("string-form difference counts as a change (parity: '0500' -> 500)", () => {
    const s = makeShipment({ price_per_kg_cents: 500 });
    const draft = { ...draftFromShipment(s), price_per_kg_cents: "0500" };
    expect(diffShipmentDraft(draft, s)).toEqual({ price_per_kg_cents: 500 });
  });
});

describe("diffShipmentDraft — key order (byte-identical JSON)", () => {
  it("emits changed keys in the original saveAll order", () => {
    const s = makeShipment({ name: "old", price_per_kg_cents: 100, notes: "old" });
    const draft = {
      ...draftFromShipment(s),
      name: "new",
      price_per_kg_cents: "200",
      notes: "new",
    };
    const patch = diffShipmentDraft(draft, s);
    expect(Object.keys(patch)).toEqual(["name", "price_per_kg_cents", "notes"]);
  });
});

describe("local-input round-trip", () => {
  it("empty round-trips to '' / null", () => {
    expect(toLocalInput(null)).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });

  it("minute-precision ISO round-trips through local input", () => {
    const iso = new Date(2026, 5, 20, 8, 5).toISOString();
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });
});
