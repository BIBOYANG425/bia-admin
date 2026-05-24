import { describe, expect, test } from "vitest";

import { createArticleExcerpt } from "./excerpt";

describe("createArticleExcerpt", () => {
  test("extracts decoded text from html and collapses whitespace", () => {
    expect(
      createArticleExcerpt(`
        <p>BIA&nbsp;helps <strong>students</strong>
        find&nbsp;direction.</p>
      `),
    ).toBe("BIA helps students find direction.");
  });

  test("removes unsafe non-content before extracting text", () => {
    expect(
      createArticleExcerpt(`
        <p>Hello community.</p>
        <script>alert("bad")</script>
        <style>.x { color: red; }</style>
      `),
    ).toBe("Hello community.");
  });

  test("truncates at a word boundary with an ellipsis", () => {
    expect(
      createArticleExcerpt(
        "<p>International students explore technology innovation and career paths together.</p>",
        { maxLength: 40 },
      ),
    ).toBe("International students explore...");
  });
});
