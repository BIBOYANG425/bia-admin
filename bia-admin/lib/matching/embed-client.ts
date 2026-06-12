// lib/matching/embed-client.ts
// Typed caller of the embed Edge Function. Throws Error("embed_unavailable") on ANY
// failure — callers must treat that as "continue with tag/keyword legs" (spec §11).
// Hard 10s timeout so a hanging call fast-fails into the fallback instead of
// stalling the caller, and full payload-shape validation so a malformed response
// can never write corrupt vectors.
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const EMBED_TIMEOUT_MS = 10_000;
const DIM = 1536;

export function makeEmbedClient(supabaseUrl: string, serviceKey: string): EmbedFn {
  return async (texts: string[]) => {
    const res = await fetch(`${supabaseUrl}/functions/v1/embed`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    }).catch(() => null);
    if (!res || !res.ok) throw new Error("embed_unavailable");
    const data = await res.json().catch(() => null);
    if (
      !data ||
      data.dim !== DIM ||
      !Array.isArray(data.embeddings) ||
      data.embeddings.length !== texts.length ||
      !data.embeddings.every(
        (v: unknown) => Array.isArray(v) && v.length === DIM && v.every((n) => typeof n === "number"),
      )
    ) {
      throw new Error("embed_unavailable");
    }
    return data.embeddings as number[][];
  };
}
