import { describe, it, expect, vi } from "vitest";
import {
  MARKETPLACE_WEEKLY_CAP,
  countApprovedSubmissionsThisWeek,
} from "../cap-enforcement";

// Minimal chainable mock of the supabase query used by the helper:
//   admin.from(t).select(c, {count, head}).eq(k, v).gte(k, v)  -> { count, error }
function fakeAdmin(result: { count?: number | null; error?: unknown }) {
  const thenable = {
    eq() {
      return this;
    },
    gte() {
      return Promise.resolve(result);
    },
  };
  return {
    from: vi.fn(() => ({ select: () => thenable })),
  };
}

describe("countApprovedSubmissionsThisWeek", () => {
  it("returns the count when the query succeeds", async () => {
    const admin = fakeAdmin({ count: 7, error: null });
    expect(await countApprovedSubmissionsThisWeek(admin as never)).toBe(7);
  });

  it("treats a null count as 0", async () => {
    const admin = fakeAdmin({ count: null, error: null });
    expect(await countApprovedSubmissionsThisWeek(admin as never)).toBe(0);
  });

  it("throws on a query error", async () => {
    const admin = fakeAdmin({ count: null, error: { message: "boom" } });
    await expect(countApprovedSubmissionsThisWeek(admin as never)).rejects.toThrow("boom");
  });

  it("exposes the weekly cap constant as 20", () => {
    expect(MARKETPLACE_WEEKLY_CAP).toBe(20);
  });
});
