"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, UploadCloud, X } from "lucide-react";
import { createBiaBrowserClient } from "@biboyang425/bia-shared/supabase/browser";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const COVER_BUCKET = "article-covers";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

interface SignedUploadResponse {
  path?: string;
  token?: string;
  publicUrl?: string;
  error?: string;
  message?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CoverImageInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  async function uploadCover(file: File) {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error("Use a JPG, PNG, WEBP, or GIF cover image.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error("Cover image must be 5 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const signRes = await fetch("/api/admin/articles/cover-upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mime: file.type }),
      });
      const signed = (await signRes.json().catch(() => ({}))) as SignedUploadResponse;

      if (!signRes.ok) {
        throw new Error(signed.error ?? signed.message ?? "cover_sign_failed");
      }
      if (!signed.path || !signed.token) {
        throw new Error("cover_upload_metadata_missing");
      }

      const supa = createBiaBrowserClient();
      const { error } = await supa.storage
        .from(COVER_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file, {
          contentType: file.type,
        });

      if (error) {
        throw error;
      }

      const publicUrl =
        signed.publicUrl ??
        supa.storage.from(COVER_BUCKET).getPublicUrl(signed.path).data.publicUrl;

      onChange(publicUrl);
      toast.success("Cover image uploaded");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void uploadCover(file);
  }

  function handleDragEnter(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (disabled || uploading) return;
    setIsDragOver(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (disabled || uploading) return;
    // Tell the OS this is a "copy" operation; otherwise the cursor shows a stop icon.
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragOver(false);
    if (disabled || uploading) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    void uploadCover(file);
  }

  function openFilePicker() {
    if (disabled || uploading) return;
    inputRef.current?.click();
  }

  const interactive = !(disabled || uploading);

  return (
    <div className="space-y-2">
      <Label htmlFor="cover-image">Cover image</Label>

      <label
        htmlFor="cover-image"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          "relative block overflow-hidden rounded-lg border-2 border-dashed transition-colors",
          interactive ? "cursor-pointer" : "cursor-not-allowed opacity-70",
          isDragOver
            ? "border-emerald-400 bg-emerald-50"
            : value
              ? "border-zinc-200 bg-white"
              : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          id="cover-image"
          type="file"
          accept={ALLOWED_MIME_TYPES.join(",")}
          onChange={handleFileChange}
          disabled={disabled || uploading}
          className="sr-only"
        />

        {value ? (
          <div className="relative">
            <img
              src={value}
              alt="Article cover preview"
              className="aspect-[16/9] w-full object-cover"
            />
            <div className="flex items-center justify-between gap-3 border-t bg-white/95 px-3 py-2 text-xs">
              <p className="truncate text-muted-foreground">{value}</p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    openFilePicker();
                  }}
                  disabled={!interactive}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    onChange(null);
                  }}
                  disabled={!interactive}
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div
              className={[
                "flex h-12 w-12 items-center justify-center rounded-full",
                isDragOver
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-zinc-100 text-zinc-500",
              ].join(" ")}
            >
              {uploading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <UploadCloud className="h-6 w-6" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-900">
                {uploading
                  ? "Uploading…"
                  : isDragOver
                    ? "Drop to upload"
                    : "Drag an image here, or click to browse"}
              </p>
              <p className="text-xs text-muted-foreground">
                JPG, PNG, WEBP, or GIF · up to 5 MB
              </p>
            </div>
          </div>
        )}

        {uploading && value && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm shadow-md">
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading…
            </div>
          </div>
        )}
      </label>
    </div>
  );
}
