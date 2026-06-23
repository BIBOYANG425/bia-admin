import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, __resetRateLimitStore } from "../rate-limit";

beforeEach(() => __resetRateLimitStore());

describe("checkRateLimit", () => {
  it("allows up to the limit then blocks", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("k", 3, 60_000).allowed).toBe(true);
    }
    const blocked = checkRateLimit("k", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("keys are independent", () => {
    expect(checkRateLimit("a", 1, 60_000).allowed).toBe(true);
    expect(checkRateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(checkRateLimit("b", 1, 60_000).allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    try {
      expect(checkRateLimit("k", 1, 1000).allowed).toBe(true);
      expect(checkRateLimit("k", 1, 1000).allowed).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(checkRateLimit("k", 1, 1000).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
