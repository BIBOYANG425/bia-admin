import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

export interface AdminAuditEntry {
  adminEmail: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Best-effort admin audit write. Audit failures should never block the
 * user-facing action that triggered them.
 */
export async function logAdminAction(entry: AdminAuditEntry): Promise<void> {
  try {
    const admin = createBiaServiceRoleClient();
    await admin.from("admin_audit_log").insert({
      admin_email: entry.adminEmail,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      payload: entry.payload ?? {},
    });
  } catch {
    // Best effort only.
  }
}
