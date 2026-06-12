// lib/matching/extractor.ts
// The extractor IS the privacy filter (spec §7.1, eng E6): it accepts ONLY
// whitelisted sources (interests/major/year + memory `interests` + memory `state`)
// and emits interest-shaped tags + facet texts. relationships/identity/george_notes
// are not parameters — excluded by construction, enforced by the type.
// A deny-list backstop drops non-interest items the model lets through.
// Note: @anthropic-ai/sdk is loaded lazily inside anthropicLlm() so unit tests
// (which inject a mock LlmCall) never require the SDK to be installed.

export interface ExtractorSources {
  interests: string[];
  major: string | null;
  year: string | null;
  memoryInterests: string | null;
  memoryState: string | null;
}

export interface ExtractedInterests {
  tags: string[];                       // normalized: lowercase, snake_case
  facets: { label: string; text: string }[]; // ≤8, each embedded separately
}

const FACET_CAP = 8;
const NON_INTEREST = /visa|stress|anxiet|health|sick|breakup|homesick|grade|gpa|deadline|rent due/i;

export function buildExtractorInput(s: ExtractorSources): string {
  return [
    `interests: ${s.interests.join(", ") || "(none)"}`,
    `major: ${s.major ?? "(unknown)"} · year: ${s.year ?? "(unknown)"}`,
    `notes on interests: ${s.memoryInterests ?? "(none)"}`,
    `recent (extract ONLY interest-shaped items, ignore everything personal): ${s.memoryState ?? "(none)"}`,
  ].join("\n");
}

const PROMPT = `You extract a student's activity interests for matching them to group activities (food runs, sports, study, gaming, music, outdoors).
Return STRICT JSON: {"tags": string[], "facets": [{"label": string, "text": string}]}.
tags: short interest keywords, english snake_case where possible (korean_food, kbbq, hiking, valorant). Merge synonyms (韩烤/kbbq/korean bbq → both korean_food and kbbq is fine).
facets: 3-8 distinct interest clusters; "text" is one rich sentence describing that interest for semantic matching, bilingual ok.
NEVER include personal circumstances (visa, stress, health, relationships, grades) as tags or facets. Interests only.`;

export const normalizeTag = (t: string) =>
  t.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");

export type LlmCall = (system: string, user: string) => Promise<string>;

export function anthropicLlm(apiKey: string): LlmCall {
  // Lazy import: @anthropic-ai/sdk is loaded only when this factory is called,
  // not at module evaluation time. This keeps unit tests SDK-free.
  return async (system, user) => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = msg.content[0];
    return block.type === "text" ? block.text : "";
  };
}

export async function extractInterests(
  sources: ExtractorSources,
  llm: LlmCall,
): Promise<ExtractedInterests> {
  const raw = await llm(PROMPT, buildExtractorInput(sources));
  let parsed: { tags?: unknown; facets?: unknown };
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    throw new Error("extractor_parse_failed");
  }
  if (!Array.isArray(parsed.tags) || !Array.isArray(parsed.facets)) {
    throw new Error("extractor_parse_failed");
  }
  // LLM output is untrusted: coerce element shapes (drop non-strings) before
  // normalizing, and dedupe facet labels — duplicate labels in one batch would
  // violate the (student_id, label) upsert conflict target downstream.
  const tags = (parsed.tags as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map(normalizeTag)
    .filter((t) => t.length > 1 && !NON_INTEREST.test(t.replace(/_/g, " ")));
  const seenLabels = new Set<string>();
  const facets = (parsed.facets as unknown[])
    .filter((f): f is { label: string; text: string } =>
      !!f && typeof (f as { label?: unknown }).label === "string" &&
      typeof (f as { text?: unknown }).text === "string")
    .filter((f) => f.label.trim() && f.text.trim() && !NON_INTEREST.test(f.text))
    .map((f) => ({ label: normalizeTag(f.label), text: f.text }))
    .filter((f) => f.label.length > 0 && !seenLabels.has(f.label) && seenLabels.add(f.label) !== undefined)
    .slice(0, FACET_CAP);
  return { tags: [...new Set(tags)], facets };
}
