import { describe, expect, test } from "vitest";

import { sanitizeArticleHtml } from "./sanitize";

describe("sanitizeArticleHtml", () => {
  test("removes executable markup, inline images, and unsafe attributes", () => {
    const clean = sanitizeArticleHtml(`
      <h1 onclick="alert(1)">Hi</h1>
      <script>alert(2)</script>
      <a href="javascript:alert(3)">bad</a>
      <img src="https://example.com/cover.png" onerror="alert(4)" />
    `);

    expect(clean).toContain("<h1>Hi</h1>");
    expect(clean).not.toContain("<img");
    expect(clean).not.toContain("cover.png");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("javascript:");
  });

  test("preserves common article formatting", () => {
    const clean = sanitizeArticleHtml(`
      <h2>Event Recap</h2>
      <p><strong>Students</strong> explored <em>AI products</em>.</p>
      <ul><li>Career context</li><li>Founder stories</li></ul>
      <blockquote>Build what students actually need.</blockquote>
    `);

    expect(clean).toContain("<h2>Event Recap</h2>");
    expect(clean).toContain("<strong>Students</strong>");
    expect(clean).toContain("<em>AI products</em>");
    expect(clean).toContain("<li>Career context</li>");
    expect(clean).toContain("<blockquote>");
  });
});
