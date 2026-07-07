// Pure draft + diff helpers for the parcel editor (status / weight / dims /
// notes). Replaces the 6 parallel per-field draft `useState`s + the inline
// per-field diff in the parcel detail page. A single `ParcelEditDraft` object
// holds each field as the string its input produces; `diffParcelEditDraft`
// compares it against the loaded parcel and emits ONLY changed fields, in the
// same key order the old `handleSaveAll` used, so the PATCH payload is
// byte-for-byte identical.
//
// Note the number semantics differ from the shipment editor: parcels compare
// the *transformed* number (via `numOrNull`) against the parcel value, so
// "0500" vs stored 500 is NOT a change here. Text (`notes`) keeps "" (not null).
// The `received_at` stamp on the received_cn flip is a side effect the page adds
// after this diff — intentionally NOT part of this pure helper.
//
// Header last reviewed: 2026-07-07

import type { Parcel, ParcelStatus } from "@biboyang425/bia-shared/shipping";

export interface ParcelEditDraft {
  status: ParcelStatus | "";
  weight_grams: string;
  dim_cm_l: string;
  dim_cm_w: string;
  dim_cm_h: string;
  notes: string;
}

/** Numeric string → number, or null when blank / non-finite (trims first). */
export function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Seed a draft from the loaded parcel (matches the old per-field seeding). */
export function draftFromParcel(p: Parcel): ParcelEditDraft {
  return {
    status: p.status,
    weight_grams: p.weight_grams !== null ? String(p.weight_grams) : "",
    dim_cm_l: p.dim_cm_l !== null ? String(p.dim_cm_l) : "",
    dim_cm_w: p.dim_cm_w !== null ? String(p.dim_cm_w) : "",
    dim_cm_h: p.dim_cm_h !== null ? String(p.dim_cm_h) : "",
    notes: p.notes ?? "",
  };
}

/**
 * Generic diff of a parcel edit draft against the loaded parcel. Emits only
 * changed fields, preserving the original per-field semantics exactly:
 *   status  — emitted only when non-empty AND changed.
 *   numbers — compared as numOrNull(draft) vs (parcel.value ?? null).
 *   notes   — text, "" kept (not normalized to null).
 * The received_cn `received_at` stamp is added by the caller, not here.
 */
export function diffParcelEditDraft(
  draft: ParcelEditDraft,
  parcel: Parcel,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (draft.status && draft.status !== parcel.status) patch.status = draft.status;

  const weight = numOrNull(draft.weight_grams);
  if (weight !== (parcel.weight_grams ?? null)) patch.weight_grams = weight;
  const l = numOrNull(draft.dim_cm_l);
  if (l !== (parcel.dim_cm_l ?? null)) patch.dim_cm_l = l;
  const w = numOrNull(draft.dim_cm_w);
  if (w !== (parcel.dim_cm_w ?? null)) patch.dim_cm_w = w;
  const h = numOrNull(draft.dim_cm_h);
  if (h !== (parcel.dim_cm_h ?? null)) patch.dim_cm_h = h;

  if (draft.notes !== (parcel.notes ?? "")) patch.notes = draft.notes;

  return patch;
}
