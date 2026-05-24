import { describe, expect, test } from "vitest";

import { sanitizeArticleHtml } from "./sanitize";

describe("sanitizeArticleHtml", () => {
  test("strips XSS vectors: script tags, event handlers, javascript: URLs", () => {
    const clean = sanitizeArticleHtml(`
      <h1 onclick="alert(1)">Hi</h1>
      <script>alert(2)</script>
      <a href="javascript:alert(3)">bad</a>
      <img src="https://example.com/cover.png" onerror="alert(4)" />
    `);

    expect(clean).toContain("<h1>Hi</h1>");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("javascript:");
  });

  test("preserves images now that articles ship their own design", () => {
    const clean = sanitizeArticleHtml(
      `<img src="https://example.com/cover.png" alt="Cover" width="800">`,
    );

    expect(clean).toContain("<img");
    expect(clean).toContain('src="https://example.com/cover.png"');
    expect(clean).toContain('alt="Cover"');
  });

  test("preserves <style> tags and their contents (design fidelity)", () => {
    const clean = sanitizeArticleHtml(
      `<style>.hero { color: red; font-family: serif; }</style><div class="hero">Hi</div>`,
    );

    expect(clean).toContain("<style>");
    expect(clean).toContain(".hero");
    expect(clean).toContain("color: red");
    expect(clean).toContain('class="hero"');
  });

  test("preserves class, id, and style attributes", () => {
    const clean = sanitizeArticleHtml(
      `<p class="lede" id="opener" style="font-size:18px">Body</p>`,
    );

    expect(clean).toContain('class="lede"');
    expect(clean).toContain('id="opener"');
    expect(clean).toContain('style="font-size:18px"');
  });

  test("strips iframe / object / embed / form / input regardless", () => {
    const clean = sanitizeArticleHtml(`
      <iframe src="https://evil.example.com"></iframe>
      <object data="evil.swf"></object>
      <embed src="evil.swf">
      <form action="/steal"><input name="creds"></form>
    `);

    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<object");
    expect(clean).not.toContain("<embed");
    expect(clean).not.toContain("<form");
    expect(clean).not.toContain("<input");
  });

  test("preserves layout tags (header / section / article / figure)", () => {
    const clean = sanitizeArticleHtml(
      `<article><header><h1>T</h1></header><section><p>Body</p></section><figure><img src="https://x/a.png"><figcaption>Caption</figcaption></figure></article>`,
    );

    expect(clean).toContain("<article>");
    expect(clean).toContain("<header>");
    expect(clean).toContain("<section>");
    expect(clean).toContain("<figure>");
    expect(clean).toContain("<figcaption>Caption</figcaption>");
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
