import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

export const SPONSOR_LOGO_BUCKET = "sponsor-logos";

/**
 * Parse the object path inside the `sponsor-logos` bucket from a Supabase public
 * storage URL. Mirrors coverStoragePathFromUrl (lib/admin/article-covers.ts).
 * Returns null when the URL is not a sponsor-logos object so callers can skip
 * removal rather than guessing.
 */
export function logoStoragePathFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const marker = `/storage/v1/object/`;
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) return null;

  let rest = pathname.slice(markerIndex + marker.length);
  rest = rest.replace(/^(public|authenticated|sign)\//, "");

  const prefix = `${SPONSOR_LOGO_BUCKET}/`;
  if (!rest.startsWith(prefix)) return null;

  const objectPath = rest.slice(prefix.length);
  if (!objectPath) return null;

  try {
    return decodeURIComponent(objectPath);
  } catch {
    return objectPath;
  }
}

/**
 * Best-effort removal of a logo object from the `sponsor-logos` bucket given its
 * public URL. Never throws — a failed storage cleanup must not break the
 * user-facing sponsor action that triggered it. No-ops when the URL is not a
 * sponsor-logos object.
 */
export async function removeSponsorLogoByUrl(
  url: string | null | undefined,
): Promise<void> {
  const path = logoStoragePathFromUrl(url);
  if (!path) return;

  try {
    const admin = createBiaServiceRoleClient();
    const { error } = await admin.storage
      .from(SPONSOR_LOGO_BUCKET)
      .remove([path]);
    if (error) {
      console.error("sponsor logo cleanup failed:", error.message);
    }
  } catch (error) {
    console.error("sponsor logo cleanup threw:", error);
  }
}
