// Status-transition policy for officer edits (2026-06-24 decision: "block
// regressions + terminal"). The admin console let an officer set ANY status in
// one call — forming→archived, or arbitrary backward moves — with no guard. This
// allows the safe moves and rejects the dangerous ones:
//   • forward to any later stage           → allowed (officers may skip ahead)
//   • one step back on the happy path       → allowed (mis-click correction)
//   • two-or-more steps back                → REJECTED (regression)
//   • out of a terminal state               → REJECTED (e.g. picked_up, archived)
//   • into / out of a branch/exception state→ allowed (lost/returned/declined …)
//   • same → same (editing other fields)    → allowed (no-op)

export interface TransitionPolicy {
  /** Happy-path order; index = stage, higher = further along. */
  order: readonly string[];
  /** Truly irreversible end states — no transition out (a no-op is still fine). */
  terminal: ReadonlySet<string>;
  /** Off-path exception states — enter from / exit to anywhere (while non-terminal). */
  branch: ReadonlySet<string>;
}

export type TransitionResult = { ok: true } | { ok: false; reason: string };

export function checkTransition(
  policy: TransitionPolicy,
  from: string,
  to: string,
): TransitionResult {
  if (from === to) return { ok: true };
  if (policy.terminal.has(from)) {
    return { ok: false, reason: `${from} is a final state and cannot change` };
  }
  // Entering or leaving an exception state is always allowed from a non-terminal.
  if (policy.branch.has(to) || policy.branch.has(from)) return { ok: true };
  const fi = policy.order.indexOf(from);
  const ti = policy.order.indexOf(to);
  // Unknown status on either side → don't block here (enum is validated upstream).
  if (fi === -1 || ti === -1) return { ok: true };
  if (ti >= fi - 1) return { ok: true }; // forward, or one step back
  return {
    ok: false,
    reason: `cannot move backward from ${from} to ${to}`,
  };
}

export const PARCEL_TRANSITION: TransitionPolicy = {
  order: ["expected", "received_cn", "in_transit", "arrived_us", "picked_up"],
  terminal: new Set(["picked_up"]),
  branch: new Set(["lost", "returned", "disputed"]),
};

export const SHIPMENT_TRANSITION: TransitionPolicy = {
  order: [
    "forming",
    "sealed",
    "departed_cn",
    "customs",
    "arrived_us",
    "pickup_open",
    "pickup_closed",
    "archived",
  ],
  terminal: new Set(["archived"]),
  branch: new Set(),
};

export const PACK_REQUEST_TRANSITION: TransitionPolicy = {
  order: ["pending", "contacted", "approved", "packed", "shipped"],
  terminal: new Set(["shipped"]),
  branch: new Set(["declined", "cancelled"]),
};

export const SHIPMENT_REQUEST_TRANSITION: TransitionPolicy = {
  order: ["pending", "contacted", "scheduled", "completed"],
  terminal: new Set(["completed"]),
  branch: new Set(["declined"]),
};
