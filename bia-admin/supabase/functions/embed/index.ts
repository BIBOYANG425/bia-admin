// supabase/functions/embed/index.ts
// THE single owner of embeddings (spec §6.4, eng E2): model, dims, key, and failure
// shape live here and nowhere else. Callers treat any non-200 as "fall back to
// tag/keyword legs" (spec §11) — never block a write on this function.
// Deploy: supabase MCP deploy_edge_function. Secret: OPENAI_API_KEY.

const MODEL = "text-embedding-3-small"; // 1536-dim, multilingual — matches vector(1536)
const MAX_TEXTS = 32;
const MAX_CHARS = 2000;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  let texts: unknown;
  try {
    ({ texts } = await req.json());
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TEXTS ||
      !texts.every((t) => typeof t === "string" && t.length > 0)) {
    return Response.json({ error: "invalid_texts" }, { status: 400 });
  }
  const input = (texts as string[]).map((t) => t.slice(0, MAX_CHARS));

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return Response.json({ error: "missing_key" }, { status: 500 });

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, input }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: "upstream_failed", status: res.status, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }
  // Validate upstream shape before returning — a malformed 200 must surface as
  // upstream_failed (callers' fallback path), never as a crash or corrupt vectors.
  const data = await res.json().catch(() => null);
  const items = data?.data;
  if (
    !Array.isArray(items) ||
    items.length !== input.length ||
    !items.every((d: { embedding?: unknown }) =>
      Array.isArray(d?.embedding) && d.embedding.length === 1536 &&
      d.embedding.every((n: unknown) => typeof n === "number"))
  ) {
    return Response.json(
      { error: "upstream_failed", detail: "malformed embedding payload" },
      { status: 502 },
    );
  }
  const embeddings = items.map((d: { embedding: number[] }) => d.embedding);
  return Response.json({ model: MODEL, dim: 1536, embeddings });
});
