import * as React from "react";
import { sanitizeArticleHtml } from "./sanitize";

export interface ArticleRendererProps {
  html: string;
  className?: string;
}

export function ArticleRenderer({
  html,
  className = "prose prose-neutral max-w-none",
}: ArticleRendererProps) {
  // Defense in depth: sanitize on write AND on render. Cheap insurance against
  // a bypass of the write-time sanitize.
  const safeHtml = sanitizeArticleHtml(html);
  return <div className={className} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
