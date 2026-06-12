// scripts/backfill-matching.ts
// One-shot Phase-0 backfill: build tags + facet vectors for every student with any
// interest signal, and embed existing squad_posts. Idempotent; --dry-run prints only.
// Run: pnpm exec tsx scripts/backfill-matching.ts [--dry-run]
//
// EMBED-UNAVAILABLE ADAPTATION (spec §11):
// If the embed Edge Function is unavailable (OPENAI_API_KEY not set or function not deployed),
// buildUserVectors falls back to tags-only (embedded=false). This is expected and counted
// in the tagOnly bucket. Post embeddings are also skipped with a warning. Never a blocker.
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import { anthropicLlm, extractInterests } from "../lib/matching/extractor";
import { makeEmbedClient } from "../lib/matching/embed-client";
import { buildUserVectors } from "../lib/matching/vector-builder";

function env(k: string): string {
  if (process.env[k]) return process.env[k]!;
  const line = fs.readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(k + "="));
  if (!line) throw new Error(`missing env ${k}`);
  return line.slice(k.length + 1).trim();
}

const DRY = process.argv.includes("--dry-run");

async function main() {
  const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const embed = makeEmbedClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  // Lazy: --dry-run must work without ANTHROPIC_API_KEY (no LLM calls happen).
  let llmInstance: ReturnType<typeof anthropicLlm> | null = null;
  const llm: ReturnType<typeof anthropicLlm> = (system, user) => {
    llmInstance ??= anthropicLlm(env("ANTHROPIC_API_KEY"));
    return llmInstance(system, user);
  };

  // Students with any interest signal: interests[] OR a george memory profile.
  // DB read errors are real failures — never mask them as embed availability.
  const { data: students, error } = await admin
    .from("students")
    .select("id, name, major, year, interests, user_id");
  if (error) throw error;
  const { data: profiles, error: profErr } = await admin
    .from("user_profiles").select("user_id, interests, state");
  if (profErr) throw profErr;
  const profByUser = new Map((profiles ?? []).map((p: { user_id: string; interests: string | null; state: string | null }) => [p.user_id, p]));

  let built = 0, skipped = 0, tagOnly = 0;
  for (const s of students ?? []) {
    const prof = s.user_id ? profByUser.get(s.user_id) : undefined;
    const hasSignal = (s.interests?.length ?? 0) > 0 || !!prof;
    if (!hasSignal) { skipped++; continue; }
    if (DRY) { console.log(`[dry] would build: ${s.id} (${s.name})`); built++; continue; }
    const extracted = await extractInterests({
      interests: s.interests ?? [],
      major: s.major, year: s.year,
      memoryInterests: prof?.interests ?? null,
      memoryState: prof?.state ?? null,        // whitelist: ONLY interests + state blocks
    }, llm);
    const res = await buildUserVectors(admin, s.id, extracted, embed);
    res.embedded ? built++ : tagOnly++;
    console.log(`built ${s.id} tags=${res.tags} facets=${res.facets} embedded=${res.embedded}`);
  }

  // Embed existing posts that lack embeddings. Only EMBED failures fall back
  // (spec §11); DB read/update failures must surface, not masquerade as embed issues.
  const { data: posts, error: postsErr } = await admin
    .from("squad_posts").select("id, content, category").is("embedding", null);
  if (postsErr) throw postsErr;
  for (const p of posts ?? []) {
    if (DRY) { console.log(`[dry] would embed post ${p.id}`); continue; }
    let vec: number[];
    try {
      [vec] = await embed([`${p.category}: ${p.content}`]);
    } catch {
      console.warn(`post ${p.id}: embed unavailable, left null (tag/fts legs still work)`);
      continue;
    }
    const { error: updErr } = await admin
      .from("squad_posts").update({ embedding: JSON.stringify(vec) }).eq("id", p.id);
    if (updErr) throw new Error(`post ${p.id} embedding write failed: ${updErr.message}`);
    console.log(`embedded post ${p.id}`);
  }

  console.log(JSON.stringify({ built, tagOnly, skipped }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
