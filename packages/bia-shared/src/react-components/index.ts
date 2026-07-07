// React components live behind this subpath (@biboyang425/bia-shared/react),
// NOT in the root barrel or ./articles. They carry a hard dependency on the
// `react` peer (and the "use client" directive), so keeping them out of the
// root barrel lets pure Node/server consumers import types + logic without
// dragging React into their bundle. Source-only, like ./next/* — bundler
// consumers (Next.js) compile the .tsx directly.
export { ArticleRenderer } from "./ArticleRenderer";
export type { ArticleRendererProps } from "./ArticleRenderer";
