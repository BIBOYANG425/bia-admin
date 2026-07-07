// Pure article logic only — NO React. The ArticleRenderer component moved to
// the ./react subpath (@biboyang425/bia-shared/react) in 3.0.0 so that
// importing article helpers (or the root barrel) never pulls in React.
export { createArticleExcerpt, deriveExcerpt } from "./excerpt";
export type { ExcerptOptions } from "./excerpt";
export {
  findMissingImages,
  fillImageSrc,
  stripEmptyImages,
} from "./images";
export type { MissingImage } from "./images";
export { sanitizeArticleHtml } from "./sanitize";
export { createArticleSlug, slugify, withCollisionSuffix } from "./slug";
export type { SlugOptions } from "./slug";
