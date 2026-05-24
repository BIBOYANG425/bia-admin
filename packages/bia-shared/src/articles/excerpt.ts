import { sanitizeArticleHtml } from "./sanitize";

export interface ExcerptOptions {
  maxLength?: number;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function createArticleExcerpt(
  html: string,
  { maxLength = 200 }: ExcerptOptions = {},
): string {
  // Decode entities BEFORE collapsing whitespace so &nbsp; (→  ) gets
  // folded along with other whitespace runs.
  const text = decodeEntities(sanitizeArticleHtml(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength + 1);
  const boundary = clipped.lastIndexOf(" ");
  const prefix = boundary > 0 ? clipped.slice(0, boundary) : text.slice(0, maxLength);
  return `${prefix.trimEnd()}...`;
}

export function deriveExcerpt(html: string, max = 200): string {
  return createArticleExcerpt(html, { maxLength: max });
}
