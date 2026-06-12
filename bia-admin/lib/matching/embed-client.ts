// lib/matching/embed-client.ts
// Typed caller of the embed Edge Function. Throws Error("embed_unavailable") on ANY
// failure — callers must treat that as "continue with tag/keyword legs" (spec §11).
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export function makeEmbedClient(supabaseUrl: string, serviceKey: string): EmbedFn {
  return async (texts: string[]) => {
    const res = await fetch(`${supabaseUrl}/functions/v1/embed`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ texts }),
    }).catch(() => null);
    if (!res || !res.ok) throw new Error("embed_unavailable");
    const data = await res.json().catch(() => null);
    if (!data?.embeddings || data.dim !== 1536) throw new Error("embed_unavailable");
    return data.embeddings as number[][];
  };
}
