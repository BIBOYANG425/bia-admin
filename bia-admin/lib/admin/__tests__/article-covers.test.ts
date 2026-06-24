import { describe, expect, it } from "vitest";

import { coverStoragePathFromUrl } from "../article-covers";

describe("coverStoragePathFromUrl", () => {
  it("extracts the object path from a public storage URL", () => {
    expect(
      coverStoragePathFromUrl(
        "https://abc.supabase.co/storage/v1/object/public/article-covers/cover_123.jpg",
      ),
    ).toBe("cover_123.jpg");
  });

  it("decodes percent-encoded characters in the path", () => {
    expect(
      coverStoragePathFromUrl(
        "https://abc.supabase.co/storage/v1/object/public/article-covers/folder%20one/cover.png",
      ),
    ).toBe("folder one/cover.png");
  });

  it("handles authenticated render paths", () => {
    expect(
      coverStoragePathFromUrl(
        "https://abc.supabase.co/storage/v1/object/authenticated/article-covers/cover_9.webp",
      ),
    ).toBe("cover_9.webp");
  });

  it("returns null for a different bucket", () => {
    expect(
      coverStoragePathFromUrl(
        "https://abc.supabase.co/storage/v1/object/public/sponsor-logos/logo.png",
      ),
    ).toBeNull();
  });

  it("returns null for an external (non-storage) URL", () => {
    expect(
      coverStoragePathFromUrl("https://cdn.example.com/cover.jpg"),
    ).toBeNull();
  });

  it("returns null for null/empty/malformed input", () => {
    expect(coverStoragePathFromUrl(null)).toBeNull();
    expect(coverStoragePathFromUrl(undefined)).toBeNull();
    expect(coverStoragePathFromUrl("")).toBeNull();
    expect(coverStoragePathFromUrl("not a url")).toBeNull();
  });
});
