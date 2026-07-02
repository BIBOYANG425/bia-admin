import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueShippingNotifications,
  pickupWindowKey,
  type ShippingNotificationRow,
} from "../notify";

const row = (over: Partial<ShippingNotificationRow> = {}): ShippingNotificationRow => ({
  student_id: "st-1",
  parcel_id: "p1",
  kind: "pickup_open",
  dedup_key: "p1:pickup_open:s1:1751500800",
  payload: { member_id: "M001" },
  status: "pending",
  scheduled_for: "2026-07-03T00:00:00Z",
  ...over,
});

describe("pickupWindowKey", () => {
  it("discriminates by shipment + window start (epoch seconds, format-stable with SQL)", () => {
    const key = pickupWindowKey(
      "p1",
      "pickup_open",
      "s1",
      "2026-07-03T00:00:00.000Z",
    );
    expect(key).toMatch(/^p1:pickup_open:s1:\d{10}$/);
    // Same window rendered in a different ISO offset → same key (epoch, not text).
    expect(
      pickupWindowKey("p1", "pickup_open", "s1", "2026-07-03T08:00:00+08:00"),
    ).toBe(key);
  });
  it("falls back to 'na' with no start time", () => {
    expect(pickupWindowKey("p1", "pickup_reminder", "s1", null)).toBe(
      "p1:pickup_reminder:s1:na",
    );
  });
  it("two different windows for the same parcel produce different keys (reopen can notify again)", () => {
    const w1 = pickupWindowKey("p1", "pickup_open", "s1", "2026-07-03T00:00:00Z");
    const w2 = pickupWindowKey("p1", "pickup_open", "s1", "2026-07-10T00:00:00Z");
    expect(w1).not.toBe(w2);
  });
});

describe("enqueueShippingNotifications", () => {
  const upsertMock = vi.fn();
  const eqMock = vi.fn();
  const in2Mock = vi.fn(() => ({ eq: eqMock }));
  const in1Mock = vi.fn(() => ({ in: in2Mock }));
  const deleteMock = vi.fn(() => ({ in: in1Mock }));
  const fromMock = vi.fn(() => ({ upsert: upsertMock, delete: deleteMock }));
  const admin = { from: fromMock } as unknown as SupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue({ error: null });
    eqMock.mockResolvedValue({ error: null });
  });

  it("no-ops on an empty batch", async () => {
    await enqueueShippingNotifications(admin, []);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("plain enqueue: upserts with ignoreDuplicates and no delete", async () => {
    await enqueueShippingNotifications(admin, [row()]);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith([row()], {
      onConflict: "dedup_key",
      ignoreDuplicates: true,
    });
  });

  it("refreshPending: deletes this batch's still-pending rows (any key) first", async () => {
    await enqueueShippingNotifications(
      admin,
      [row(), row({ parcel_id: "p2", kind: "pickup_reminder", dedup_key: "x" })],
      { refreshPending: true },
    );
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(in1Mock).toHaveBeenCalledWith("parcel_id", ["p1", "p2"]);
    expect(in2Mock).toHaveBeenCalledWith("kind", [
      "pickup_open",
      "pickup_reminder",
    ]);
    // Sent rows are never touched — only pending are superseded.
    expect(eqMock).toHaveBeenCalledWith("status", "pending");
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("swallows queue-side failures — an officer action must never break here", async () => {
    upsertMock.mockResolvedValue({ error: { message: "boom" } });
    await expect(
      enqueueShippingNotifications(admin, [row()]),
    ).resolves.toBeUndefined();
    upsertMock.mockRejectedValue(new Error("network"));
    await expect(
      enqueueShippingNotifications(admin, [row()]),
    ).resolves.toBeUndefined();
  });
});
