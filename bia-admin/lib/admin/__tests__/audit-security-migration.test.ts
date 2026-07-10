import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../supabase/migrations/20260710210853_audit_security_and_state_machines.sql",
  ),
  "utf8",
).toLowerCase();

describe("audit security and state-machine migration", () => {
  it("makes the public sponsor projection invoker-safe and removes the obsolete squad view", () => {
    expect(sql).toContain("security_invoker = true");
    expect(sql).toMatch(/grant select \([^)]*id[^)]*name[^)]*display_order[^)]*\)\s+on (table )?public\.sponsors\s+to anon, authenticated/s);
    expect(sql).toContain("drop view if exists public.squad_member_counts");
    expect(sql).toContain("pg_depend");
  });

  it.each([
    "approve_event_submission(uuid, uuid)",
    "append_to_profile_block(uuid, text, text)",
    "publish_scheduled_articles()",
  ])("revokes and service-role-grants privileged function %s", (signature) => {
    expect(sql).toContain(`revoke all on function public.${signature} from public`);
    expect(sql).toContain(`revoke all on function public.${signature} from anon, authenticated`);
    expect(sql).toContain(`grant execute on function public.${signature} to service_role`);
  });

  it.each([
    "user_observations",
    "proactive_raised_threads",
    "identity_conflicts",
    "student_followups",
    "outgoing_bubbles",
  ])("locks down internal table %s with RLS and explicit grants", (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`);
    expect(sql).toMatch(
      new RegExp(`grant (?:select, insert, update, delete|all) on table public\\.${table} to service_role`),
    );
  });

  it.each([
    "claim_due_student_followups",
    "claim_due_outgoing_bubbles",
    "admin_delete_event_atomic",
    "admin_create_parcel_atomic",
    "admin_update_article_atomic",
    "admin_update_member_role_atomic",
    "admin_delete_member_atomic",
    "admin_revoke_invitation_atomic",
    "create_pack_request",
  ])("defines hardened transactional RPC %s", (name) => {
    expect(sql).toContain(`function public.${name}(`);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*? from public`));
  });

  it("guards duplicate roommate owners before adding the partial unique index", () => {
    expect(sql).toContain("roommate_profiles_duplicate_user_id");
    expect(sql).toMatch(
      /create unique index[^;]*on public\.roommate_profiles\s*\(user_id\)\s*where user_id is not null/s,
    );
  });

  it("uses row locks and skip-locked leases for claim RPCs", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("outgoing_bubbles_claim_idx");
    expect(sql).toContain("student_followups_claim_idx");
  });
});
