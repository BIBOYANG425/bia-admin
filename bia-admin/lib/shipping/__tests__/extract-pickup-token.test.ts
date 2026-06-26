import { describe, expect, it } from "vitest";
import { extractPickupToken } from "../extract-pickup-token";

const TOK = "a1b2c3d4";

describe("extractPickupToken", () => {
  it("accepts a bare token (trimmed)", () => {
    expect(extractPickupToken(TOK)).toBe(TOK);
    expect(extractPickupToken("  a1b2c3d4 ")).toBe(TOK);
  });

  it("lowercases hex from an uppercase scan", () => {
    expect(extractPickupToken("A1B2C3D4")).toBe(TOK);
  });

  it("extracts ?t= from a URL", () => {
    expect(extractPickupToken("https://admin.uscbia.com/pickup?t=a1b2c3d4")).toBe(TOK);
  });

  it("extracts the last path segment from a URL", () => {
    expect(extractPickupToken("https://admin.uscbia.com/pickup/a1b2c3d4")).toBe(TOK);
  });

  it("extracts token / pickup_token from JSON", () => {
    expect(extractPickupToken('{"token":"a1b2c3d4"}')).toBe(TOK);
    expect(
      extractPickupToken('{"pickup_token":"a1b2c3d4","parcel_id":"x"}'),
    ).toBe(TOK);
  });

  it("rejects non-token shapes", () => {
    expect(extractPickupToken("")).toBeNull();
    expect(extractPickupToken("   ")).toBeNull();
    expect(extractPickupToken("not a token")).toBeNull();
    expect(extractPickupToken("zzzzzzzz")).toBeNull(); // 8 chars, not hex
    expect(extractPickupToken("a1b2c3")).toBeNull(); // too short
    expect(extractPickupToken("a1b2c3d4e5")).toBeNull(); // too long
    expect(extractPickupToken("{not json")).toBeNull();
    expect(extractPickupToken("https://x.com/")).toBeNull(); // no segment
    expect(extractPickupToken("https://x.com/pickup?t=zzzz")).toBeNull();
  });
});
