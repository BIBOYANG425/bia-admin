import { describe, it, expect } from "vitest";
import {
  checkTransition,
  SHIPMENT_TRANSITION,
  PACK_REQUEST_TRANSITION,
  SHIPMENT_REQUEST_TRANSITION,
  PARCEL_TRANSITION,
} from "../transitions";

describe("checkTransition — happy path (shipment)", () => {
  const P = SHIPMENT_TRANSITION;
  it("allows the same status (no-op edit)", () => {
    expect(checkTransition(P, "forming", "forming").ok).toBe(true);
  });
  it("allows any forward jump", () => {
    expect(checkTransition(P, "forming", "departed_cn").ok).toBe(true);
    expect(checkTransition(P, "forming", "pickup_open").ok).toBe(true);
  });
  it("allows a one-step-back correction", () => {
    expect(checkTransition(P, "customs", "departed_cn").ok).toBe(true);
  });
  it("rejects a multi-step regression", () => {
    const r = checkTransition(P, "arrived_us", "forming");
    expect(r.ok).toBe(false);
  });
  it("rejects leaving a terminal state", () => {
    expect(checkTransition(P, "archived", "forming").ok).toBe(false);
    expect(checkTransition(P, "archived", "pickup_open").ok).toBe(false);
  });
});

describe("checkTransition — branch / exception states", () => {
  it("parcel: may be marked lost/returned/disputed from any live state", () => {
    expect(checkTransition(PARCEL_TRANSITION, "in_transit", "lost").ok).toBe(true);
    expect(checkTransition(PARCEL_TRANSITION, "expected", "disputed").ok).toBe(true);
  });
  it("parcel: a lost parcel can be resolved back onto the happy path", () => {
    expect(checkTransition(PARCEL_TRANSITION, "lost", "in_transit").ok).toBe(true);
  });
  it("parcel: cannot leave picked_up (terminal)", () => {
    expect(checkTransition(PARCEL_TRANSITION, "picked_up", "arrived_us").ok).toBe(false);
  });
  it("pack-request: declined/cancelled are reachable + reversible", () => {
    expect(checkTransition(PACK_REQUEST_TRANSITION, "pending", "declined").ok).toBe(true);
    expect(checkTransition(PACK_REQUEST_TRANSITION, "cancelled", "pending").ok).toBe(true);
  });
  it("pack-request: cannot leave shipped (terminal)", () => {
    expect(checkTransition(PACK_REQUEST_TRANSITION, "shipped", "packed").ok).toBe(false);
  });
});

describe("checkTransition — shipment-request", () => {
  const P = SHIPMENT_REQUEST_TRANSITION;
  it("allows forward + one-step-back, rejects multi-back + leaving completed", () => {
    expect(checkTransition(P, "pending", "scheduled").ok).toBe(true);
    expect(checkTransition(P, "scheduled", "contacted").ok).toBe(true); // one back
    expect(checkTransition(P, "completed", "pending").ok).toBe(false); // terminal
    expect(checkTransition(P, "scheduled", "declined").ok).toBe(true); // branch
  });
});
