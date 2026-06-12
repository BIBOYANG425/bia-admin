// lib/matching/identity.ts
// students.id is the canonical identity for the matching engine (spec §9, eng E1).
// Maps: auth.users.id → students.user_id; iMessage handle → students.imessage_id.
// JIT-provisions a students row for web-auth users (the user_id bridge is sparse:
// most web signups have no students row). Handles never JIT — george's onboarding
// handshake owns student creation for iMessage users.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface IdentityRef {
  studentId?: string;
  authUserId?: string;
  imessageHandle?: string;
}

async function lookup(admin: SupabaseClient, col: string, val: string): Promise<string | null> {
  const { data, error } = await admin.from("students").select("id").eq(col, val).maybeSingle();
  if (error) throw new Error(`identity lookup failed: ${error.message}`);
  return (data?.id as string) ?? null;
}

export async function resolveStudentId(admin: SupabaseClient, ref: IdentityRef): Promise<string | null> {
  if (ref.studentId) return lookup(admin, "id", ref.studentId);
  if (ref.imessageHandle) return lookup(admin, "imessage_id", ref.imessageHandle);
  if (ref.authUserId) {
    const existing = await lookup(admin, "user_id", ref.authUserId);
    if (existing) return existing;
    // JIT provisioning: pull name/email from auth and create the bridge row.
    const { data: u, error } = await admin.auth.admin.getUserById(ref.authUserId);
    if (error || !u?.user) return null;
    const name = (u.user.user_metadata?.full_name as string) ?? u.user.email ?? "USC student";
    const { data: created, error: insErr } = await admin
      .from("students")
      .insert({ user_id: ref.authUserId, name })
      .select()
      .single();
    if (insErr) throw new Error(`JIT student create failed: ${insErr.message}`);
    return created.id as string;
  }
  return null;
}
