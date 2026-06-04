import { describe, expect, it } from "vitest";
import {
  PARCEL_STATUS_META,
  PARCEL_STATUS_VALUES,
  SHIPMENT_STEPS,
  SHIPPING_METHOD_META,
  SHIPPING_METHOD_VALUES,
  PARCEL_STEPS,
  nextParcelStatus,
  nextShipmentStatus,
} from "./index";

describe("nextParcelStatus", () => {
  it("advances along the happy path", () => {
    expect(nextParcelStatus("expected")).toBe("received_cn");
    expect(nextParcelStatus("arrived_us")).toBe("picked_up");
  });
  it("returns null at the end of the path", () => {
    expect(nextParcelStatus("picked_up")).toBeNull();
  });
  it("returns null for off-path/branch statuses", () => {
    expect(nextParcelStatus("lost")).toBeNull();
  });
});

describe("nextShipmentStatus", () => {
  it("advances along the lifecycle", () => {
    expect(nextShipmentStatus("forming")).toBe("sealed");
  });
  it("returns null at the final state", () => {
    expect(nextShipmentStatus("archived")).toBeNull();
  });
});

describe("metadata completeness", () => {
  it("PARCEL_STATUS_META covers every parcel status", () => {
    for (const s of PARCEL_STATUS_VALUES) {
      expect(PARCEL_STATUS_META[s]).toBeDefined();
    }
  });
  it("SHIPPING_METHOD_META covers every method", () => {
    for (const m of SHIPPING_METHOD_VALUES) {
      expect(SHIPPING_METHOD_META[m]).toBeDefined();
    }
  });
  it("PARCEL_STEPS are all valid parcel statuses", () => {
    for (const s of PARCEL_STEPS) {
      expect(PARCEL_STATUS_VALUES).toContain(s);
    }
  });
  it("SHIPMENT_STEPS has 8 stages", () => {
    expect(SHIPMENT_STEPS).toHaveLength(8);
  });
});
