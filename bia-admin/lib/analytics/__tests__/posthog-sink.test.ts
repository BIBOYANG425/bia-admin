import { describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

import posthog from "posthog-js";
import { createPostHogSink, POSTHOG_ENABLED } from "../posthog-sink";

describe("createPostHogSink", () => {
  it("is disabled and returns null when NEXT_PUBLIC_POSTHOG_KEY is unset (safe default)", () => {
    expect(process.env.NEXT_PUBLIC_POSTHOG_KEY).toBeFalsy();
    expect(POSTHOG_ENABLED).toBe(false);
    expect(createPostHogSink()).toBeNull();
    // Must NOT touch posthog when there's no key — the app stays analytics-silent.
    expect((posthog as unknown as { init: ReturnType<typeof vi.fn> }).init).not.toHaveBeenCalled();
  });
});
