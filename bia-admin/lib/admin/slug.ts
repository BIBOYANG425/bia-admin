import { withCollisionSuffix } from "@biboyang425/bia-shared/articles";
import type { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

type AdminClient = ReturnType<typeof createBiaServiceRoleClient>;

function slugCandidates(base: string): string[] {
  return [base, ...Array.from({ length: 99 }, (_, i) => `${base}-${i + 2}`)];
}

/**
 * Find the first available slug starting from `base`.
 *
 * Policy (unified across create / PATCH / submit):
 *  - Draft rows are never counted as collisions.
 *  - The row identified by `excludeId` (if provided) is never counted,
 *    regardless of status.
 *
 * Queries exactly 100 candidates in one `.in()` round-trip.
 */
export async function findAvailableSlug(
  admin: AdminClient,
  base: string,
  options?: { excludeId?: string },
): Promise<{ slug: string; error: null } | { slug: null; error: { message?: string } }> {
  const { data, error } = await admin
    .from("articles")
    .select("id, slug, status")
    .in("slug", slugCandidates(base));

  if (error) return { slug: null, error };

  const taken = new Set(
    (data ?? [])
      .filter(
        (row: { id: string; status: string }) =>
          row.status !== "draft" &&
          (options?.excludeId === undefined || row.id !== options.excludeId),
      )
      .map((row: { slug: string }) => row.slug),
  );

  return { slug: withCollisionSuffix(base, taken), error: null };
}
