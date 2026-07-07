/**
 * Shared signed-upload flow for article images (cover + inline slots).
 *
 * Both the cover input and the missing-images panel used to duplicate this
 * whole dance: validate the file, POST to /api/admin/articles/cover-upload for
 * a signed URL, push the bytes to Supabase storage, then resolve a public URL.
 * The flow lives here once; callers keep their own toast copy.
 *
 * Validation runs before any network call, so an oversize/wrong-mime file is
 * rejected without touching fetch. `validateImageFile` is exported for callers
 * that want to surface a context-specific message before showing a spinner.
 *
 * Header last reviewed: 2026-07-06
 */

import { createBiaBrowserClient } from "@biboyang425/bia-shared/supabase/browser";

/** Storage bucket that backs both cover images and inline article images. */
export const ARTICLE_IMAGE_BUCKET = "article-covers";

/** Max accepted image size: 5 MB. */
export const ARTICLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Image MIME types the cover-upload endpoint accepts. */
export const ARTICLE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** `accept` attribute value for the file inputs. */
export const ARTICLE_IMAGE_ACCEPT = ARTICLE_IMAGE_MIME_TYPES.join(",");

export type ImageValidationReason = "mime" | "size";

export type ImageValidationResult =
  | { ok: true }
  | { ok: false; reason: ImageValidationReason };

/**
 * Check a file against the mime whitelist and size cap. Pure — no network.
 * Callers use this to show a context-specific toast before the upload spins up.
 */
export function validateImageFile(file: File): ImageValidationResult {
  if (!(ARTICLE_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "mime" };
  }
  if (file.size > ARTICLE_IMAGE_MAX_BYTES) {
    return { ok: false, reason: "size" };
  }
  return { ok: true };
}

/** Thrown by uploadArticleImage when the file fails local validation. */
export class ArticleImageValidationError extends Error {
  readonly reason: ImageValidationReason;
  constructor(reason: ImageValidationReason) {
    super(`invalid_image_${reason}`);
    this.name = "ArticleImageValidationError";
    this.reason = reason;
  }
}

interface SignedUploadResponse {
  path?: string;
  token?: string;
  publicUrl?: string;
  error?: string;
  message?: string;
}

/**
 * Validate → sign → upload → resolve public URL. Rejects with
 * ArticleImageValidationError (before any fetch) when the file is the wrong
 * type or too large. Resolves to the public URL of the stored image.
 */
export async function uploadArticleImage(file: File): Promise<string> {
  const check = validateImageFile(file);
  if (!check.ok) {
    throw new ArticleImageValidationError(check.reason);
  }

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
    .from(ARTICLE_IMAGE_BUCKET)
    .uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: file.type,
    });

  if (error) {
    throw error;
  }

  return (
    signed.publicUrl ??
    supa.storage.from(ARTICLE_IMAGE_BUCKET).getPublicUrl(signed.path).data
      .publicUrl
  );
}
