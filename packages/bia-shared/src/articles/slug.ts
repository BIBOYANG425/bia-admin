export interface SlugOptions {
  maxLength?: number;
  fallback?: string;
}

export function createArticleSlug(
  title: string,
  { maxLength = 80, fallback = "article" }: SlugOptions = {},
): string {
  const normalized = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const base = normalized || fallback;
  if (base.length <= maxLength) return base;

  const truncated = base.slice(0, maxLength).replace(/-+$/g, "");
  return truncated || fallback;
}

export function slugify(title: string, options?: SlugOptions): string {
  return createArticleSlug(title, options);
}

export function withCollisionSuffix(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;

  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
