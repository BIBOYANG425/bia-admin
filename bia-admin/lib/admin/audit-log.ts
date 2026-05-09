import { createBiaServiceRoleClient } from "@biboyang425/bia-shared";

export interface AuditEntry {
  admin_email: string;
  action: string;
  entity_type: "admin_user" | "admin_invitation";
  entity_id?: string | null;
  payload?: Record<string, unknown>;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
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
}
