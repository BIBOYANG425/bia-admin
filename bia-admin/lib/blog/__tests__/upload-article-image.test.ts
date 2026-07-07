import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ARTICLE_IMAGE_ACCEPT,
  ARTICLE_IMAGE_BUCKET,
  ARTICLE_IMAGE_MAX_BYTES,
  ARTICLE_IMAGE_MIME_TYPES,
  ArticleImageValidationError,
  uploadArticleImage,
  validateImageFile,
} from "../upload-article-image";

// validateImageFile / uploadArticleImage only read .type, .size and .name, so a
// plain stub avoids allocating 5 MB+ of bytes to exercise the size branch.
function fakeFile(type: string, size: number, name = "img"): File {
  return { type, size, name } as unknown as File;
}

describe("validateImageFile", () => {
  it("accepts an allowed mime under the size cap", () => {
    expect(validateImageFile(fakeFile("image/png", 1024))).toEqual({ ok: true });
  });

  it("accepts a file exactly at the size cap", () => {
    expect(
      validateImageFile(fakeFile("image/jpeg", ARTICLE_IMAGE_MAX_BYTES)),
    ).toEqual({ ok: true });
  });

  it("rejects a disallowed mime", () => {
    expect(validateImageFile(fakeFile("application/pdf", 10))).toEqual({
      ok: false,
      reason: "mime",
    });
  });

  it("rejects an oversize file", () => {
    expect(
      validateImageFile(fakeFile("image/png", ARTICLE_IMAGE_MAX_BYTES + 1)),
    ).toEqual({ ok: false, reason: "size" });
  });

  it("checks mime before size (wrong type + oversize reports mime)", () => {
    expect(
      validateImageFile(fakeFile("text/plain", ARTICLE_IMAGE_MAX_BYTES + 1)),
    ).toEqual({ ok: false, reason: "mime" });
  });
});

describe("article image constants", () => {
  it("exposes the storage bucket and accept string", () => {
    expect(ARTICLE_IMAGE_BUCKET).toBe("article-covers");
    expect(ARTICLE_IMAGE_ACCEPT).toBe(
      "image/jpeg,image/png,image/webp,image/gif",
    );
    expect(ARTICLE_IMAGE_MIME_TYPES).toContain("image/webp");
    expect(ARTICLE_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("uploadArticleImage validation guards (no network)", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a wrong-mime file before any fetch", async () => {
    await expect(
      uploadArticleImage(fakeFile("application/pdf", 100)),
    ).rejects.toBeInstanceOf(ArticleImageValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tags the wrong-mime rejection reason as 'mime'", async () => {
    await expect(
      uploadArticleImage(fakeFile("application/pdf", 100)),
    ).rejects.toMatchObject({ reason: "mime" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an oversize file before any fetch", async () => {
    await expect(
      uploadArticleImage(fakeFile("image/png", ARTICLE_IMAGE_MAX_BYTES + 1)),
    ).rejects.toBeInstanceOf(ArticleImageValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tags the oversize rejection reason as 'size'", async () => {
    await expect(
      uploadArticleImage(fakeFile("image/png", ARTICLE_IMAGE_MAX_BYTES + 1)),
    ).rejects.toMatchObject({ reason: "size" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
