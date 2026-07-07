import { describe, it, expect } from "vitest";
import { fmtDate, fmtDateTime } from "../format";

// Use a local-time ISO string (no trailing Z) so the rendered date and hour
// are timezone-independent across CI environments.
const LOCAL_ISO = "2024-03-15T14:30:00";

describe("fmtDate", () => {
  it("returns — for null", () => {
    expect(fmtDate(null)).toBe("—");
  });

  it("returns — for undefined", () => {
    expect(fmtDate(undefined)).toBe("—");
  });

  it("returns — for empty string", () => {
    expect(fmtDate("")).toBe("—");
  });

  it("formats a date with zh-CN locale (short month)", () => {
    expect(fmtDate(LOCAL_ISO)).toBe("2024年3月15日");
  });
});

describe("fmtDateTime", () => {
  it("returns — for null", () => {
    expect(fmtDateTime(null)).toBe("—");
  });

  it("returns — for undefined", () => {
    expect(fmtDateTime(undefined)).toBe("—");
  });

  it("returns — for empty string", () => {
    expect(fmtDateTime("")).toBe("—");
  });

  it("formats a datetime with zh-CN locale (short month, 2-digit hour)", () => {
    expect(fmtDateTime(LOCAL_ISO)).toBe("2024年3月15日 14:30");
  });
});
