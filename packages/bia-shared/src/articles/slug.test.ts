import { describe, expect, test } from "vitest";

import { createArticleSlug } from "./slug";

describe("createArticleSlug", () => {
  test("normalizes English titles into URL-safe slugs", () => {
    expect(createArticleSlug("BIA Career Night: AI & Entertainment!")).toBe(
      "bia-career-night-ai-entertainment",
    );
  });

  test("keeps readable unicode words for multilingual titles", () => {
    expect(createArticleSlug("新生 Service 2026!")).toBe("新生-service-2026");
  });

  test("falls back when the title has no usable slug characters", () => {
    expect(createArticleSlug("!!!")).toBe("article");
  });

  test("truncates without leaving a trailing separator", () => {
    expect(createArticleSlug("One Two Three Four", { maxLength: 13 })).toBe(
      "one-two-three",
    );
  });
});
