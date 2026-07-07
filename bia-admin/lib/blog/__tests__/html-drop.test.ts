import { describe, it, expect } from "vitest";

import {
  detectLanguage,
  extractTitleFromHtml,
  firstUsableTitle,
  htmlToPlainText,
} from "../html-drop";

describe("detectLanguage", () => {
  it("returns en for an empty string", () => {
    expect(detectLanguage("")).toBe("en");
  });

  it("returns en for text with no letters", () => {
    expect(detectLanguage("123 !!! --- ...")).toBe("en");
  });

  it("returns en for predominantly latin text", () => {
    expect(
      detectLanguage("This is an English article about USC events."),
    ).toBe("en");
  });

  it("returns zh for predominantly CJK text", () => {
    expect(detectLanguage("这是一篇关于南加大活动的中文文章")).toBe("zh");
  });

  it("returns en when the CJK share stays at/below 20%", () => {
    // One CJK glyph amid ~25 latin letters -> ~4%, below the threshold.
    expect(detectLanguage("USC campus life and community 好")).toBe("en");
  });

  it("returns zh when the CJK share exceeds 20%", () => {
    expect(detectLanguage("USC 加州大学南校区活动介绍与报名")).toBe("zh");
  });

  it("ignores punctuation/whitespace when computing the ratio", () => {
    // 2 latin + 2 CJK letters -> 50% CJK -> zh.
    expect(detectLanguage("ab 中文!!!")).toBe("zh");
  });
});

describe("firstUsableTitle", () => {
  it("returns null when every candidate is empty or nullish", () => {
    expect(firstUsableTitle([null, undefined, "", "   "])).toBeNull();
  });

  it("returns the first non-empty candidate, trimmed", () => {
    expect(firstUsableTitle([null, "  Hello World  ", "second"])).toBe(
      "Hello World",
    );
  });

  it("skips blank candidates and picks a later usable one", () => {
    expect(firstUsableTitle(["   ", undefined, "Real Title"])).toBe(
      "Real Title",
    );
  });

  it("caps the chosen title at 200 characters", () => {
    expect(firstUsableTitle(["x".repeat(500)])).toHaveLength(200);
  });
});

// In Node/server runs DOMParser is undefined, so these helpers degrade to a
// safe null / passthrough. (Browser behavior is exercised via firstUsableTitle.)
describe("extractTitleFromHtml (no DOM environment)", () => {
  it("returns null when DOMParser is unavailable", () => {
    expect(typeof DOMParser).toBe("undefined");
    expect(extractTitleFromHtml("<h1>Title</h1>")).toBeNull();
  });
});

describe("htmlToPlainText (no DOM environment)", () => {
  it("returns the input unchanged when DOMParser is unavailable", () => {
    expect(htmlToPlainText("<p>hi</p>")).toBe("<p>hi</p>");
  });
});
