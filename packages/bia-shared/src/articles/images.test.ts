import { describe, expect, test } from "vitest";

import {
  findMissingImages,
  fillImageSrc,
  stripEmptyImages,
} from "./images";

describe("findMissingImages", () => {
  test("returns nothing when every img has a usable src", () => {
    const html = `<img src="a.png"><img src="b.png" alt="b">`;
    expect(findMissingImages(html)).toEqual([]);
  });

  test("flags tags with no src, empty src, and whitespace src", () => {
    const html = [
      `<img alt="A">`,
      `<img src="" alt="B">`,
      `<img src="   " alt="C">`,
      `<img src="ok.png" alt="D">`,
    ].join("");
    expect(findMissingImages(html)).toEqual([
      { emptyIndex: 0, alt: "A" },
      { emptyIndex: 1, alt: "B" },
      { emptyIndex: 2, alt: "C" },
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(findMissingImages("")).toEqual([]);
  });
});

describe("fillImageSrc", () => {
  test("adds src to the Nth empty img", () => {
    const html = `<img alt="A"><img src="x" alt="B"><img alt="C">`;
    expect(fillImageSrc(html, 1, "https://example.com/c.jpg")).toBe(
      `<img alt="A"><img src="x" alt="B"><img alt="C" src="https://example.com/c.jpg">`,
    );
  });

  test("escapes double quotes in the injected src", () => {
    const html = `<img alt="A">`;
    expect(fillImageSrc(html, 0, `https://x/a"b.jpg`)).toBe(
      `<img alt="A" src="https://x/a&quot;b.jpg">`,
    );
  });

  test("preserves self-closing form", () => {
    const html = `<img alt="A" />`;
    expect(fillImageSrc(html, 0, "https://x/a.jpg")).toBe(
      `<img alt="A" src="https://x/a.jpg" />`,
    );
  });

  test("no-op when index is out of range", () => {
    const html = `<img alt="A">`;
    expect(fillImageSrc(html, 5, "https://x/a.jpg")).toBe(html);
  });
});

describe("stripEmptyImages", () => {
  test("removes only the img tags without a usable src", () => {
    const html = `<p>before</p><img alt="A"><img src="x.png" alt="B"><img src=""><p>after</p>`;
    expect(stripEmptyImages(html)).toBe(
      `<p>before</p><img src="x.png" alt="B"><p>after</p>`,
    );
  });

  test("returns input unchanged when all imgs are valid", () => {
    const html = `<img src="a.png"><img src="b.png">`;
    expect(stripEmptyImages(html)).toBe(html);
  });
});
