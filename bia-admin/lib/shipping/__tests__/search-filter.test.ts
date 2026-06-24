import { describe, it, expect } from "vitest";
import { sanitizeSearchTerm } from "../search-filter";

describe("sanitizeSearchTerm", () => {
  it("keeps ordinary alphanumeric / CJK / dash / dot terms", () => {
    expect(sanitizeSearchTerm("BIA-EGBJ96")).toBe("BIA-EGBJ96");
    expect(sanitizeSearchTerm("  Uniqlo 羽绒服 ")).toBe("Uniqlo 羽绒服");
    expect(sanitizeSearchTerm("SF1234.5")).toBe("SF1234.5");
  });

  it("strips PostgREST .or() structural + escape chars (injection vector)", () => {
    // a comma would otherwise start a new top-level or() condition
    expect(sanitizeSearchTerm("x,member_id.eq.BIA-1")).toBe("xmember_id.eq.BIA-1");
    expect(sanitizeSearchTerm("a(b)c")).toBe("abc");
    expect(sanitizeSearchTerm('he said "*"')).toBe("he said");
    expect(sanitizeSearchTerm("back\\slash")).toBe("backslash");
  });

  it("handles null / undefined / blank", () => {
    expect(sanitizeSearchTerm(null)).toBe("");
    expect(sanitizeSearchTerm(undefined)).toBe("");
    expect(sanitizeSearchTerm("   ")).toBe("");
  });
});
