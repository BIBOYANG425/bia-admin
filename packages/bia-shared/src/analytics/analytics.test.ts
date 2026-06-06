import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_EVENTS,
  identify,
  resetAnalytics,
  setAnalyticsSink,
  track,
  type AnalyticsSink,
} from "./index";

function mockSink(): AnalyticsSink & {
  capture: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
} {
  return { capture: vi.fn(), identify: vi.fn(), reset: vi.fn() };
}

afterEach(() => {
  setAnalyticsSink(null); // reset module state between tests
});

describe("analytics façade", () => {
  it("no-ops when no sink is registered (safe to ship before a provider exists)", () => {
    // Should not throw even though nothing is wired.
    expect(() => track(ANALYTICS_EVENTS.subletPostCreated, { count: 1 })).not.toThrow();
    expect(() => identify("u_abc")).not.toThrow();
    expect(() => resetAnalytics()).not.toThrow();
  });

  it("forwards event name + props to the sink once registered", () => {
    const sink = mockSink();
    setAnalyticsSink(sink);
    track(ANALYTICS_EVENTS.shippingParcelDeclared, { method: "sea", count: 2 });
    expect(sink.capture).toHaveBeenCalledTimes(1);
    expect(sink.capture).toHaveBeenCalledWith("shipping_parcel_declared", {
      method: "sea",
      count: 2,
    });
  });

  it("scrubs PII keys from event props", () => {
    const sink = mockSink();
    setAnalyticsSink(sink);
    track(ANALYTICS_EVENTS.roommateContacted, {
      email: "a@usc.edu",
      name: "Alice",
      phone: "123",
      member_id: "BIA-1",
      contactEmail: "b@usc.edu",
      count: 3,
      method: "sea",
    });
    expect(sink.capture).toHaveBeenCalledWith("roommate_contacted", {
      count: 3,
      method: "sea",
    });
  });

  it("does NOT over-scrub innocent keys that merely contain 'name'", () => {
    const sink = mockSink();
    setAnalyticsSink(sink);
    track(ANALYTICS_EVENTS.coursePlanGenerated, {
      filename: "plan.pdf",
      event_name: "x",
    });
    expect(sink.capture).toHaveBeenCalledWith("course_plan_generated", {
      filename: "plan.pdf",
      event_name: "x",
    });
  });

  it("identify forwards distinct id + scrubbed traits", () => {
    const sink = mockSink();
    setAnalyticsSink(sink);
    identify("u_hashed_123", { cohort: "2026", email: "a@usc.edu" });
    expect(sink.identify).toHaveBeenCalledWith("u_hashed_123", { cohort: "2026" });
  });

  it("resetAnalytics forwards to the sink", () => {
    const sink = mockSink();
    setAnalyticsSink(sink);
    resetAnalytics();
    expect(sink.reset).toHaveBeenCalledTimes(1);
  });

  it("setAnalyticsSink(null) disables tracking again", () => {
    const sink = mockSink();
    setAnalyticsSink(sink);
    setAnalyticsSink(null);
    track(ANALYTICS_EVENTS.squadJoined);
    expect(sink.capture).not.toHaveBeenCalled();
  });
});
