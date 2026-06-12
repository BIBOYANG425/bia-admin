// lib/matching/vector-builder.ts
// Persists a student's matching representation: normalized tags on students,
// faceted vectors in user_interest_vectors (max-over-facets at query time, spec §7.3).
// Embedding failure NEVER blocks the tag write (spec §11).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedInterests } from "./extractor";
import type { EmbedFn } from "./embed-client";

export interface BuildResult { studentId: string; tags: number; facets: number; embedded: boolean }

export async function buildUserVectors(
  admin: SupabaseClient,
  studentId: string,
  extracted: ExtractedInterests,
  embed: EmbedFn,
): Promise<BuildResult> {
  const { error: tagErr } = await admin
    .from("students")
    .update({ interest_tags: extracted.tags })
    .eq("id", studentId);
  if (tagErr) throw new Error(`tag write failed: ${tagErr.message}`);

  if (extracted.facets.length === 0) {
    return { studentId, tags: extracted.tags.length, facets: 0, embedded: false };
  }

  let vectors: number[][];
  try {
    vectors = await embed(extracted.facets.map((f) => `${f.label}: ${f.text}`));
  } catch {
    return { studentId, tags: extracted.tags.length, facets: extracted.facets.length, embedded: false };
  }

  const rows = extracted.facets.map((f, i) => ({
    student_id: studentId,
    label: f.label,
    vector: JSON.stringify(vectors[i]), // pgvector accepts the JSON-array literal
    source: "profile",
    updated_at: new Date().toISOString(),
  }));
  const { error: upErr } = await admin
    .from("user_interest_vectors")
    .upsert(rows, { onConflict: "student_id,label" } as never);
  if (upErr) throw new Error(`vector upsert failed: ${upErr.message}`);

  // Prune labels that no longer exist (facet set changed).
  const keep = extracted.facets.map((f) => f.label);
  const { error: delErr } = await admin
    .from("user_interest_vectors")
    .delete()
    .eq("student_id", studentId)
    .not("label", "in", `(${keep.map((l) => `"${l}"`).join(",")})`);
  if (delErr) throw new Error(`stale prune failed: ${delErr.message}`);

  return { studentId, tags: extracted.tags.length, facets: extracted.facets.length, embedded: true };
}
