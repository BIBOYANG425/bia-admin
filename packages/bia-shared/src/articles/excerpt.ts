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

// Sanitize keeps <style> contents for design fidelity, but the excerpt should
// reflect article copy, not CSS or script residue. Strip non-content tags'
// inner text before extracting.
const NON_CONTENT_TAG_RE = /<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi;

export function createArticleExcerpt(
  html: string,
  { maxLength = 200 }: ExcerptOptions = {},
): string {
  // Strip <script>/<style>/etc. blocks (tag + content) BEFORE sanitize.
  // The sanitizer removes <script> tags but leaves their inner text as
  // orphan nodes; doing the strip first prevents that leakage.
  const preStripped = html.replace(NON_CONTENT_TAG_RE, " ");
  // Then run the full sanitizer to drop remaining HTML safely.
  // Decode entities before collapsing whitespace so &nbsp; folds with the rest.
  const tagless = sanitizeArticleHtml(preStripped).replace(/<[^>]*>/g, " ");
  const text = decodeEntities(tagless).replace(/\s+/g, " ").trim();

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
