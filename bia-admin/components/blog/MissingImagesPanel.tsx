"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ImagePlus, Loader2 } from "lucide-react";
import {
  fillImageSrc,
  findMissingImages,
  type MissingImage,
} from "@biboyang425/bia-shared/articles";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ARTICLE_IMAGE_ACCEPT,
  uploadArticleImage,
  validateImageFile,
} from "@/lib/blog/upload-article-image";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MissingImagesPanel({
  html,
  onChange,
  disabled = false,
}: {
  html: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const missing = useMemo<MissingImage[]>(() => findMissingImages(html), [html]);
  if (missing.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="text-sm text-amber-900">
          <p className="font-medium">
            {missing.length} image{missing.length === 1 ? "" : "s"} need uploading
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            Empty <code className="rounded bg-amber-100 px-1 py-0.5">&lt;img&gt;</code>{" "}
            tags get dropped on save. Upload an image for each slot to keep it.
          </p>
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {missing.map((slot) => (
          <li key={slot.emptyIndex}>
            <Slot
              alt={slot.alt || `Image ${slot.emptyIndex + 1}`}
              emptyIndex={slot.emptyIndex}
              disabled={disabled}
              onUploaded={(url) => onChange(fillImageSrc(html, slot.emptyIndex, url))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Slot({
  alt,
  emptyIndex,
  onUploaded,
  disabled,
}: {
  alt: string;
  emptyIndex: number;
  onUploaded: (url: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    const check = validateImageFile(file);
    if (!check.ok) {
      toast.error(check.reason === "mime" ? "Use a JPG, PNG, WEBP, or GIF." : "Max 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const publicUrl = await uploadArticleImage(file);
      onUploaded(publicUrl);
      toast.success(`Image uploaded for slot ${emptyIndex + 1}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-3 py-2">
      <ImagePlus className="h-4 w-4 shrink-0 text-amber-700" />
      <span className="flex-1 truncate text-sm text-zinc-700" title={alt}>
        {alt}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={ARTICLE_IMAGE_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          "Upload"
        )}
      </Button>
    </div>
  );
}
