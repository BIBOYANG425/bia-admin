// Helpers for handling <img> tags that arrive without a usable src — common
// when dropping AI-drafted or template HTML where image slots are intentional
// placeholders. The admin editor surfaces these gaps and lets authors upload
// images per slot; the server drops any still-empty <img> tags on save.

export interface MissingImage {
  /** 0-based index among <img> tags that lack a usable src. */
  emptyIndex: number;
  /** alt text on the tag, if any — used as a label in the editor UI. */
  alt: string;
}

const IMG_RE = /<img\b[^>]*>/gi;

function hasUsableSrc(tag: string): boolean {
  const m = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!m) return false;
  const value = (m[2] ?? m[3] ?? "").trim();
  return value.length > 0;
}

function getAlt(tag: string): string {
  const m = tag.match(/\balt\s*=\s*("([^"]*)"|'([^']*)')/i);
  return (m?.[2] ?? m?.[3] ?? "").trim();
}

export function findMissingImages(html: string): MissingImage[] {
  if (!html) return [];
  const out: MissingImage[] = [];
  let emptyIndex = 0;
  for (const m of html.matchAll(IMG_RE)) {
    if (!hasUsableSrc(m[0])) {
      out.push({ emptyIndex, alt: getAlt(m[0]) });
      emptyIndex += 1;
    }
  }
  return out;
}

/**
 * Inject a `src="..."` into the Nth <img> tag that lacks one. Other tags
 * are untouched. If `emptyIndex` is out of range the html is returned as-is.
 */
export function fillImageSrc(
  html: string,
  emptyIndex: number,
  src: string,
): string {
  if (!html) return html;
  const escSrc = src.replace(/"/g, "&quot;");
  let cursor = 0;
  return html.replace(IMG_RE, (tag) => {
    if (hasUsableSrc(tag)) return tag;
    if (cursor++ !== emptyIndex) return tag;
    // Preserve self-closing variant (`<img ... />`).
    if (/\/\s*>$/.test(tag)) {
      return tag.replace(/\s*\/\s*>$/, ` src="${escSrc}" />`);
    }
    return tag.replace(/\s*>$/, ` src="${escSrc}">`);
  });
}

/** Remove any <img> tag that doesn't carry a usable src. */
export function stripEmptyImages(html: string): string {
  if (!html) return html;
  return html.replace(IMG_RE, (tag) => (hasUsableSrc(tag) ? tag : ""));
}
