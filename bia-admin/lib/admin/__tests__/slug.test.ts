import { beforeEach, describe, expect, it, vi } from "vitest";

const { withCollisionSuffixMock } = vi.hoisted(() => ({
  withCollisionSuffixMock: vi.fn(),
}));

vi.mock("@biboyang425/bia-shared/articles", () => ({
  withCollisionSuffix: withCollisionSuffixMock,
}));

import { findAvailableSlug } from "../slug";

// Build a minimal admin-client stub. The helper calls:
//   admin.from("articles").select("id, slug, status").in("slug", candidates)
function makeAdmin(rows: unknown[], dbError: null | { message: string } = null) {
  return {
    from: () => ({
      select: () => ({
        in: vi.fn().mockResolvedValue({ data: rows, error: dbError }),
      }),
    }),
  } as any;
}

describe("findAvailableSlug", () => {
  beforeEach(() => {
    withCollisionSuffixMock.mockReset();
    // Default: first free suffix wins.
    withCollisionSuffixMock.mockImplementation(
      (base: string, taken: Set<string>) => (taken.has(base) ? `${base}-2` : base),
    );
  });

  it("returns base when no rows exist", async () => {
    const result = await findAvailableSlug(makeAdmin([]), "welcome");
    expect(result).toEqual({ slug: "welcome", error: null });
    expect(withCollisionSuffixMock).toHaveBeenCalledWith("welcome", new Set());
  });

  it("ignores draft rows — drafts never count as collisions", async () => {
    const result = await findAvailableSlug(
      makeAdmin([{ id: "x", slug: "welcome", status: "draft" }]),
      "welcome",
    );
    expect(result).toEqual({ slug: "welcome", error: null });
    expect(withCollisionSuffixMock).toHaveBeenCalledWith("welcome", new Set());
  });

  it("counts non-draft rows as collisions", async () => {
    const result = await findAvailableSlug(
      makeAdmin([{ id: "x", slug: "welcome", status: "published" }]),
      "welcome",
    );
    expect(result).toEqual({ slug: "welcome-2", error: null });
    expect(withCollisionSuffixMock).toHaveBeenCalledWith(
      "welcome",
      new Set(["welcome"]),
    );
  });

  it("counts in_review rows as collisions", async () => {
    const result = await findAvailableSlug(
      makeAdmin([{ id: "x", slug: "welcome", status: "in_review" }]),
      "welcome",
    );
    expect(result).toEqual({ slug: "welcome-2", error: null });
    expect(withCollisionSuffixMock).toHaveBeenCalledWith(
      "welcome",
      new Set(["welcome"]),
    );
  });

  it("ignores excludeId row regardless of status", async () => {
    const result = await findAvailableSlug(
      makeAdmin([{ id: "article-1", slug: "welcome", status: "published" }]),
      "welcome",
      { excludeId: "article-1" },
    );
    expect(result).toEqual({ slug: "welcome", error: null });
    expect(withCollisionSuffixMock).toHaveBeenCalledWith("welcome", new Set());
  });

  it("still counts other non-draft rows when excludeId is set", async () => {
    const result = await findAvailableSlug(
      makeAdmin([
        { id: "article-1", slug: "welcome", status: "published" },
        { id: "article-2", slug: "welcome", status: "published" },
      ]),
      "welcome",
      { excludeId: "article-1" },
    );
    expect(result).toEqual({ slug: "welcome-2", error: null });
    expect(withCollisionSuffixMock).toHaveBeenCalledWith(
      "welcome",
      new Set(["welcome"]),
    );
  });

  it("returns error shape when DB query fails", async () => {
    const result = await findAvailableSlug(
      makeAdmin([], { message: "db error" }),
      "welcome",
    );
    expect(result).toEqual({ slug: null, error: { message: "db error" } });
  });

  it("queries exactly 100 candidates: base then base-2 through base-100", async () => {
    let captured: string[] = [];
    const admin = {
      from: () => ({
        select: () => ({
          in: (_field: string, candidates: string[]) => {
            captured = candidates;
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    await findAvailableSlug(admin, "my-slug");

    expect(captured).toHaveLength(100);
    expect(captured[0]).toBe("my-slug");
    expect(captured[1]).toBe("my-slug-2");
    expect(captured[99]).toBe("my-slug-100");
  });
});
