"use client";

import * as React from "react";
import { sanitizeArticleHtml } from "./sanitize";

export interface ArticleRendererProps {
  html: string;
  className?: string;
}

// Wrapping document so the article gets a sensible baseline (responsive
// images, fluid width, transparent background). The article's own <style>
// tags can override anything in here.
const DOC_HEAD = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base target="_top">
<style>
  html, body { margin: 0; padding: 0; background: transparent; color: inherit; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.65; color: #1f1f1f; padding: 4px; word-wrap: break-word; }
  img, video, iframe, picture, svg { max-width: 100%; height: auto; }
  a { color: #0066cc; }
  pre { overflow-x: auto; }
  table { max-width: 100%; }
</style>
</head><body>`;
const DOC_TAIL = "</body></html>";

/**
 * Renders sanitized article HTML inside a sandboxed iframe.
 *
 * The iframe gives us:
 *   - Style isolation — the article's CSS can't bleed into the host page
 *   - Script isolation — sandbox blocks any inline scripts even if a
 *     novel XSS payload slipped past the sanitizer
 *   - Full design fidelity — the article ships its own <style>, classes,
 *     images, and layout markup, and they all render as authored
 *
 * `sandbox="allow-same-origin"` lets the parent JS read the iframe's
 * scrollHeight to auto-size; scripts inside the iframe remain blocked.
 */
export function ArticleRenderer({ html, className }: ArticleRendererProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = React.useState(640);

  const safeHtml = sanitizeArticleHtml(html);
  const srcDoc = `${DOC_HEAD}${safeHtml}${DOC_TAIL}`;

  const measure = React.useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.body) return;
    const next = Math.max(
      doc.body.scrollHeight,
      doc.documentElement?.scrollHeight ?? 0,
      200,
    );
    setHeight(next + 8);
  }, []);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onLoad = () => {
      measure();
      // Images may load after the iframe's load event — remeasure when they do.
      const imgs = iframe.contentDocument?.images;
      if (imgs) {
        for (const img of Array.from(imgs)) {
          if (!img.complete) {
            img.addEventListener("load", measure, { once: true });
            img.addEventListener("error", measure, { once: true });
          }
        }
      }
      // Catch web-font / late-CSS layout shifts.
      const t1 = window.setTimeout(measure, 250);
      const t2 = window.setTimeout(measure, 900);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    };

    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [srcDoc, measure]);

  return (
    <iframe
      ref={iframeRef}
      title="Article content"
      srcDoc={srcDoc}
      // Same-origin lets the parent measure the iframe body. Scripts stay
      // blocked (no allow-scripts). No allow-forms / popups / top-nav.
      sandbox="allow-same-origin"
      className={className ?? "w-full border-0 bg-transparent"}
      style={{ height: `${height}px`, width: "100%", display: "block" }}
    />
  );
}
