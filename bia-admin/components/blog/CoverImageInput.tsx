"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { createBiaBrowserClient } from "@biboyang425/bia-shared/supabase/browser";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="space-y-2">
      <Label htmlFor="cover-image">Cover image</Label>
      <div className="grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-[160px_1fr]">
        <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border bg-zinc-50">
          {value ? (
            <img
              src={value}
              alt="Article cover preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <ImagePlus className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-2">
          <Input
            ref={inputRef}
            id="cover-image"
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            onChange={handleFileChange}
            disabled={disabled || uploading}
          />
          <div className="flex items-center gap-2">
            {uploading && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading
              </span>
            )}
            {value && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange(null)}
                disabled={disabled || uploading}
              >
                <X className="h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>
          {value && (
            <p className="truncate text-xs text-muted-foreground">{value}</p>
          )}
        </div>
      </div>
    </div>
  );
}
