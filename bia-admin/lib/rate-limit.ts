// Simple in-memory rate limiter for Vercel serverless routes.
//
// Per-instance and resets on cold start — a deterrent that caps the request
// rate of a single hot instance, not a hard cross-instance guarantee. Used to
// throttle abuse-prone admin endpoints: notably pickup-code verify, where an
// unthrottled global token lookup is otherwise a brute-force oracle for the
// short pickup code. For a hard guarantee at scale, back this with a DB/Redis
// counter.

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
}

// Records one hit against `key` and reports whether it is within `limit` per
// `windowMs`. The hit is always counted (so a blocked caller stays blocked for
// the rest of the window).
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  cleanup(now);
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

// Test seam — clears all counters.
export function __resetRateLimitStore() {
  store.clear();
  lastCleanup = Date.now();
}
