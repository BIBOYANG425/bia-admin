import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

const ALLOWED_ATTR = ["colspan", "dir", "href", "lang", "rowspan", "target", "title"];

export function sanitizeArticleHtml(input: string): string {
  if (!input) return "";

  return DOMPurify.sanitize(input, {
    ALLOWED_ATTR,
    ALLOWED_TAGS,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["class", "id", "style"],
    FORBID_TAGS: ["embed", "form", "iframe", "img", "input", "object", "script", "style"],
  }).trim();
}
