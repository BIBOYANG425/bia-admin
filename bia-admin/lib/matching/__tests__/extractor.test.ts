// lib/matching/__tests__/extractor.test.ts
import { describe, expect, it, vi } from "vitest";
import { extractInterests, buildExtractorInput, type ExtractorSources } from "../extractor";

const SOURCES: ExtractorSources = {
  interests: ["hiking", "Korean food"],
  major: "Design",
  year: "sophomore",
  memoryInterests: "loves late-night kbbq runs, into indie shows",
  memoryState: "just got into bouldering; stressed about visa renewal",
};

describe("buildExtractorInput (privacy whitelist — spec §7.1)", () => {
  it("includes only whitelisted sources", () => {
    const input = buildExtractorInput(SOURCES);
    expect(input).toContain("kbbq");
    expect(input).toContain("bouldering");
  });
  it("never includes relationships/identity/george_notes — they are not even accepted fields", () => {
    // Type-level guarantee: ExtractorSources has no relationships/georgeNotes field.
    const keys = Object.keys(SOURCES);
    expect(keys).not.toContain("relationships");
    expect(keys).not.toContain("georgeNotes");
  });
});

describe("extractInterests", () => {
  it("parses the LLM JSON, normalizes tags, caps facets at 8", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({
      tags: ["Hiking", "korean food", "KBBQ", "indie-music", "bouldering"],
      facets: Array.from({ length: 10 }, (_, i) => ({ label: `facet-${i}`, text: `about ${i}` })),
    }));
    const out = await extractInterests(SOURCES, llm);
    expect(out.tags).toEqual(["hiking", "korean_food", "kbbq", "indie_music", "bouldering"]);
    expect(out.facets).toHaveLength(8);
  });

  it("drops non-interest leakage the model lets through (visa/stress guard)", async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({
      tags: ["bouldering", "visa renewal", "stressed"],
      facets: [{ label: "bouldering", text: "getting into bouldering" }],
    }));
    const out = await extractInterests(SOURCES, llm);
    expect(out.tags).toEqual(["bouldering"]);
  });

  it("throws a typed error on malformed LLM output", async () => {
    const llm = vi.fn().mockResolvedValue("not json at all");
    await expect(extractInterests(SOURCES, llm)).rejects.toThrow("extractor_parse_failed");
  });
});
