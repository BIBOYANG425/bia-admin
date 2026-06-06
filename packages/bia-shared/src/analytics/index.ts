/* ── Analytics façade (provider-agnostic) ───────────────────────────────────
 * Apps register a sink (e.g. PostHog) via setAnalyticsSink(). Until a sink is
 * registered, EVERY call is a no-op — so this is safe to ship and instrument
 * with before any analytics key/provider exists (缺 key 就静默). track()/identify()
 * scrub known-PII keys so we never forward raw email/phone/name into the
 * analytics provider.
 *
 *   app boot ──setAnalyticsSink(posthogSink)──► sink set
 *   track(EVENT, props) ──scrub PII──► sink.capture(EVENT, cleanProps)
 *   (no sink) ──► no-op, returns silently
 *
 * Retention-roadmap Phase 0. Header last reviewed: 2026-06-06
 * ──────────────────────────────────────────────────────────────────────────── */

import { ANALYTICS_EVENTS, type AnalyticsEventName } from "./events";

export { ANALYTICS_EVENTS };
export type { AnalyticsEventName };

export type AnalyticsValue = string | number | boolean | null | undefined;
export type AnalyticsProps = Record<string, AnalyticsValue>;

export interface AnalyticsSink {
  capture(event: string, props?: AnalyticsProps): void;
  identify(distinctId: string, traits?: AnalyticsProps): void;
  reset(): void;
}

// PII guard. Keys whose lowercased form EQUALS an exact entry, or CONTAINS a
// substring entry, are dropped before anything reaches the provider. Exact set
// avoids over-scrubbing innocent keys (e.g. "filename", "event_name" keep their
// "name"); substring set catches the high-risk identifiers wherever they appear.
const PII_EXACT = new Set([
  "name",
  "full_name",
  "first_name",
  "last_name",
  "address",
  "member_id",
  "distinct_id",
]);
const PII_SUBSTR = ["email", "phone", "password", "token", "secret"];

function isPii(key: string): boolean {
  const k = key.toLowerCase();
  return PII_EXACT.has(k) || PII_SUBSTR.some((p) => k.includes(p));
}

function scrub(props?: AnalyticsProps): AnalyticsProps | undefined {
  if (!props) return props;
  const out: AnalyticsProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (isPii(k)) continue;
    out[k] = v;
  }
  return out;
}

let sink: AnalyticsSink | null = null;

/** Register (or clear, with null) the analytics provider. Call once at app boot. */
export function setAnalyticsSink(s: AnalyticsSink | null): void {
  sink = s;
}

/** Fire a typed product event. No-op until a sink is registered. PII-scrubbed. */
export function track(event: AnalyticsEventName, props?: AnalyticsProps): void {
  if (!sink) return;
  sink.capture(event, scrub(props));
}

/**
 * Associate the current session with an opaque distinct id. Pass a hashed /
 * non-PII id (NOT email or raw member_id). traits are PII-scrubbed too.
 */
export function identify(distinctId: string, traits?: AnalyticsProps): void {
  if (!sink) return;
  sink.identify(distinctId, scrub(traits));
}

/** Clear identity (e.g. on sign-out). No-op until a sink is registered. */
export function resetAnalytics(): void {
  if (!sink) return;
  sink.reset();
}
