import * as React from "react";

export interface ArticleRendererProps {
  html: string;
  className?: string;
}

export function ArticleRenderer({
  html,
  className = "prose prose-neutral max-w-none",
}: ArticleRendererProps) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
