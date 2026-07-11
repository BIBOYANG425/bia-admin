import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

/**
 * Conventional `entity_type` values. Exported as a runtime list so the
 * /admin/audit viewer can build its filter dropdown from the same source. The
 * type below keeps it open (any other string is still accepted) — `writeAudit`
 * is the single audit helper for the whole admin. New surfaces should reuse an
 * existing value or add one to this list for discoverability.
 */
export const AUDIT_ENTITY_TYPES = [
  "admin_user",
  "admin_invitation",
  "article",
  "article_comment",
  "event",
  "event_submission",
  "parcel",
  "shipment",
  "shipment_request",
  "pack_request",
  "shipping_route",
  "shipping_contact",
  "pickup",
  "squad_post",
  "sponsor",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number] | (string & {});

export interface AuditEntry {
  admin_email: string;
  action: string;
  entity_type: AuditEntityType;
  entity_id?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Best-effort append-only audit write. Mandatory on every state-changing admin
 * action (CLAUDE.md). Audit failures are logged but never thrown — a failed
 * audit insert must not break the user-facing action that triggered it.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createBiaServiceRoleClient();
    const { error } = await admin.from("admin_audit_log").insert({
      admin_email: entry.admin_email,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      payload: entry.payload ?? {},
    });
    if (error) {
      console.error("audit log insert failed:", error);
      // Do not throw — audit failure should not break user-facing actions.
    }
  } catch (err) {
    console.error("audit log insert failed:", err);
    // Do not throw — audit failure should not break user-facing actions.
  }
}

/**
 * Durable variant for mutations that must not report success without an audit
 * record. Prefer a transactional database RPC when the business write can be
 * moved into Postgres; use this at external-system boundaries where it cannot.
 */
export async function writeAuditRequired(entry: AuditEntry): Promise<void> {
  const admin = createBiaServiceRoleClient();
  const { error } = await admin.from("admin_audit_log").insert({
    admin_email: entry.admin_email,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    payload: entry.payload ?? {},
  });
  if (error) {
    throw new Error(`audit_write_failed: ${error.message}`);
  }
}
