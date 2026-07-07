/**
 * Pure helpers for the blog HTML drop zone: language detection and title
 * extraction from dropped HTML. Extracted from BlogEditor so the logic can be
 * unit-tested without rendering the client component.
 *
 * The DOM-dependent helpers (extractTitleFromHtml, htmlToPlainText) guard on
 * `typeof DOMParser` so they degrade to a null / passthrough result outside the
 * browser (e.g. Node test runs). firstUsableTitle holds the pure selection
 * logic and is tested directly.
 *
 * Header last reviewed: 2026-07-06
 */

export type ArticleLanguage = "en" | "zh";

// Heuristic: if more than 20% of letters in the visible text are CJK
// Unified Ideographs, classify as Chinese. Title characters count too,
// so dropped Chinese articles flip the language automatically.
export function detectLanguage(text: string): ArticleLanguage {
  let cjk = 0;
  let letters = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjk += 1;
      letters += 1;
    } else if (/\p{L}/u.test(ch)) {
      letters += 1;
    }
  }
  if (letters === 0) return "en";
  return cjk / letters > 0.2 ? "zh" : "en";
}

// Pick the first candidate that has visible text once trimmed, capped at 200
// characters. Returns null when none are usable.
export function firstUsableTitle(
  candidates: Array<string | null | undefined>,
): string | null {
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (trimmed) return trimmed.slice(0, 200);
  }
  return null;
}

// Pull a sensible title from dropped HTML: prefer the <title>, then the
// first <h1>, then the first <h2>. Returns null if none look usable.
export function extractTitleFromHtml(html: string): string | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return firstUsableTitle([
    doc.querySelector("title")?.textContent,
    doc.querySelector("h1")?.textContent,
    doc.querySelector("h2")?.textContent,
  ]);
}

// Strip tags client-side so we can sample text for language detection.
export function htmlToPlainText(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
}
