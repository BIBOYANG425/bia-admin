import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

export const ARTICLE_COVER_BUCKET = "article-covers";

/**
 * Parse the object path inside the `article-covers` bucket from a Supabase
 * public storage URL.
 *
 * Covers are stored via `bucket.getPublicUrl(path)`, which produces URLs of the
 * shape:
 *   https://<project>.supabase.co/storage/v1/object/public/article-covers/<path>
 *
 * Returns null when the URL is not an article-covers object (e.g. an external
 * image pasted as the cover, or a malformed value) so callers can skip removal
 * rather than guessing.
 */
export function coverStoragePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  // Match both the public and (defensively) the authenticated render paths.
  const marker = `/storage/v1/object/`;
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) return null;

  let rest = pathname.slice(markerIndex + marker.length);
  // Strip the access qualifier segment (public/, authenticated/, sign/).
  rest = rest.replace(/^(public|authenticated|sign)\//, "");

  const prefix = `${ARTICLE_COVER_BUCKET}/`;
  if (!rest.startsWith(prefix)) return null;

  const objectPath = rest.slice(prefix.length);
  if (!objectPath) return null;

  // URL-decode so paths with encoded characters resolve to the stored key.
  try {
    return decodeURIComponent(objectPath);
  } catch {
    return objectPath;
  }
}

/**
 * Best-effort removal of a cover object from the `article-covers` bucket given
 * its public URL. Never throws — a failed storage cleanup must not break the
 * user-facing article action that triggered it (mirrors writeAudit's policy).
 * No-ops when the URL is not an article-covers object.
 */
export async function removeArticleCoverByUrl(
  url: string | null | undefined,
): Promise<void> {
  const path = coverStoragePathFromUrl(url);
  if (!path) return;

  try {
    const admin = createBiaServiceRoleClient();
    const { error } = await admin.storage
      .from(ARTICLE_COVER_BUCKET)
      .remove([path]);
    if (error) {
      console.error("article cover cleanup failed:", error.message);
    }
  } catch (error) {
    console.error("article cover cleanup threw:", error);
  }
}
