"use client";

import { useState } from "react";
import { Code2, FileUp } from "lucide-react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import {
  detectLanguage,
  extractTitleFromHtml,
  htmlToPlainText,
  type ArticleLanguage,
} from "@/lib/blog/html-drop";

// Files dropped on the source pane: read as text and replace the editor body.
// The sanitize pipeline strips dangerous content on save, so any text-shaped
// file (HTML, plain text, markdown) is safe to accept here.
const HTML_DROP_MAX_BYTES = 500_000; // 500 KB

export function HtmlDropZone({
  html,
  onHtmlChange,
  title,
  onTitleChange,
  language,
  onLanguageChange,
  disabled = false,
}: {
  html: string;
  onHtmlChange: (next: string) => void;
  title: string;
  onTitleChange: (next: string) => void;
  language: ArticleLanguage;
  onLanguageChange: (next: ArticleLanguage) => void;
  disabled?: boolean;
}) {
  const [htmlDragOver, setHtmlDragOver] = useState(false);

  async function ingestHtmlFile(file: File) {
    if (file.size > HTML_DROP_MAX_BYTES) {
      toast.error("File too large (max 500 KB).");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        toast.error(`${file.name} is empty.`);
        return;
      }
      onHtmlChange(text);

      // Auto-fill metadata where it's still empty. Never overwrite something
      // the user already typed.
      const extras: string[] = [];
      if (!title.trim()) {
        const detected = extractTitleFromHtml(text);
        if (detected) {
          onTitleChange(detected);
          extras.push(`title "${detected}"`);
        }
      }
      // Always re-detect language from content (cheap, and the user can flip
      // back via the dropdown if they disagree).
      const plain = htmlToPlainText(text);
      const sample = `${title} ${plain}`.slice(0, 4000);
      const lang = detectLanguage(sample);
      if (lang !== language) {
        onLanguageChange(lang);
        extras.push(`language ${lang === "zh" ? "中文" : "English"}`);
      }

      const tail = extras.length ? ` · ${extras.join(", ")}` : "";
      toast.success(`Loaded ${file.name}${tail}`);
    } catch {
      toast.error("Could not read file.");
    }
  }

  function isFileDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleHtmlDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event) || disabled) return;
    event.preventDefault();
    setHtmlDragOver(true);
  }

  function handleHtmlDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event) || disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleHtmlDragLeave(event: React.DragEvent<HTMLDivElement>) {
    // Only clear state when leaving the wrapper, not nested children.
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setHtmlDragOver(false);
  }

  function handleHtmlDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    setHtmlDragOver(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void ingestHtmlFile(file);
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="article-html">Source HTML</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste or drop an .html file
        </p>
      </div>
      <div
        onDragEnter={handleHtmlDragEnter}
        onDragOver={handleHtmlDragOver}
        onDragLeave={handleHtmlDragLeave}
        onDrop={handleHtmlDrop}
        className="relative"
      >
        <textarea
          id="article-html"
          value={html}
          onChange={(event) => onHtmlChange(event.target.value)}
          placeholder="Paste article HTML here, or drop a file."
          disabled={disabled}
          className="min-h-[420px] w-full resize-y rounded-lg border bg-white p-3 font-mono text-sm leading-6 shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring xl:h-[58vh] xl:min-h-[560px]"
        />
        {htmlDragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-emerald-400 bg-emerald-50/90 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 text-emerald-800">
              <FileUp className="h-7 w-7" />
              <p className="text-sm font-medium">Drop to load file</p>
              <p className="text-xs text-emerald-700">
                HTML, text, or markdown — up to 500 KB
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
