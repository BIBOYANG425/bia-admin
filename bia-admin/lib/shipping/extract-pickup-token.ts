// Decode a scanned QR string into a parcel pickup token.
//
// The student-facing QR (generated on uscbia.com) encodes the bare 8-char
// `pickup_token`. To tolerate either side's encoding choice this also accepts a
// URL (`?t=<token>` or a trailing path segment) or a JSON object
// (`{token}` / `{pickup_token}`). Returns the lowercase-hex token, or null when
// nothing matches the token shape — so the scanner can say "二维码无法识别"
// instead of POSTing junk to the verify endpoint. The endpoint's own
// `z.string().max(64)` guard remains the backstop.

const TOKEN_RE = /^[0-9a-f]{8}$/;

/** Validate + canonicalize a candidate to a lowercase 8-char hex token. */
function normalizeToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim().toLowerCase();
  return TOKEN_RE.test(t) ? t : null;
}

export function extractPickupToken(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  // JSON: {"token":"..."} or {"pickup_token":"..."}
  if (s.startsWith("{")) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      const v = obj.token ?? obj.pickup_token;
      return normalizeToken(typeof v === "string" ? v : null);
    } catch {
      return null;
    }
  }

  // URL: prefer ?t=<token>, else the last non-empty path segment.
  if (/^https?:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      const fromQuery = url.searchParams.get("t");
      if (fromQuery) return normalizeToken(fromQuery);
      const seg = url.pathname.split("/").filter(Boolean).pop() ?? null;
      return normalizeToken(seg);
    } catch {
      return null;
    }
  }

  // Raw token.
  return normalizeToken(s);
}
