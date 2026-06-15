// lib/matching/__tests__/rpc.phase3.integration.test.ts
// Run: RUN_DB_TESTS=true pnpm exec vitest run lib/matching/__tests__/rpc.phase3.integration.test.ts
// Needs .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

const RUN = process.env.RUN_DB_TESTS === "true";
const d = describe.skipIf(!RUN);

function env(k: string): string {
  if (process.env[k]) return process.env[k]!;
  for (const p of [".env.local", "bia-admin/.env.local"]) {
    if (!fs.existsSync(p)) continue;
    const line = fs.readFileSync(p, "utf8").split("\n").find((l) => l.startsWith(k + "="));
    if (line) return line.slice(k.length + 1).trim();
  }
  throw new Error(`missing env ${k}`);
}

let admin: SupabaseClient;
const ids = { users: [] as string[], posts: [] as string[] };

// Create an auth user, sign in, return a JWT-bearing client + the resolved student id.
async function authed(): Promise<{ client: SupabaseClient; userId: string; studentId: string }> {
  const email = `itest-p3-${randomUUID()}@example.com`;
  const password = "test-pw-123456";
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const userId = created.user!.id;
  ids.users.push(userId);
  const client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw signErr;
  // First self-scoped call JIT-provisions the students row.
  const { error: prefErr } = await client.rpc("squad_my_prefs");
  if (prefErr) throw prefErr;
  const { data: s } = await admin.from("students").select("id").eq("user_id", userId).single();
  return { client, userId, studentId: s!.id as string };
}

async function mkPost(studentId: string): Promise<string> {
  const { data, error } = await admin.from("squad_posts").insert({
    poster_name: "itest", category: "其它", content: "p3 itest post", contact: "x",
    max_people: 4, current_people: 1, tags: ["kbbq"], created_by_student_id: studentId, created_via: "web",
  }).select().single();
  if (error) throw error;
  ids.posts.push(data.id);
  return data.id as string;
}

async function mkPing(postId: string, recipient: string): Promise<string> {
  const { data, error } = await admin.from("squad_pings").insert({
    post_id: postId, recipient_student_id: recipient, score: 0.5, status: "sent",
    sent_at: new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(() => {
  admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
});

afterAll(async () => {
  if (!RUN) return;
  if (ids.posts.length) await admin.from("squad_posts").delete().in("id", ids.posts);
  for (const u of ids.users) {
    const { data: s } = await admin.from("students").select("id").eq("user_id", u).maybeSingle();
    if (s) {
      await admin.from("user_match_prefs").delete().eq("student_id", s.id);
      await admin.from("user_interest_vectors").delete().eq("student_id", s.id);
      await admin.from("students").delete().eq("id", s.id);
    }
    await admin.auth.admin.deleteUser(u);
  }
});

d("squad phase 3 RPCs", () => {
  it("INVARIANT self-scope: squad_my_pings returns only the caller's pings", async () => {
    const a = await authed();
    const b = await authed();
    const post = await mkPost(b.studentId);
    await mkPing(post, a.studentId); // ping belongs to A

    const { data: aPings } = await a.client.rpc("squad_my_pings");
    const { data: bPings } = await b.client.rpc("squad_my_pings");
    expect((aPings ?? []).map((r: { post_id: string }) => r.post_id)).toContain(post);
    expect((bPings ?? []).length).toBe(0);
  });

  it("INVARIANT respond: only my ping, and a single response is final", async () => {
    const a = await authed();
    const b = await authed();
    const post = await mkPost(b.studentId);
    const ping = await mkPing(post, a.studentId);

    const bResp = await b.client.rpc("squad_respond_to_ping", { p_ping_id: ping, p_response: "joined" });
    expect(bResp.error).not.toBeNull();
    const a1 = await a.client.rpc("squad_respond_to_ping", { p_ping_id: ping, p_response: "joined" });
    expect(a1.error).toBeNull();
    const a2 = await a.client.rpc("squad_respond_to_ping", { p_ping_id: ping, p_response: "declined" });
    expect(a2.error).not.toBeNull();
  });

  it("INVARIANT aggregate-only: squad_my_posts returns reach_count, never recipient ids", async () => {
    const a = await authed();
    const b = await authed();
    const post = await mkPost(a.studentId);
    await mkPing(post, b.studentId);
    const { data } = await a.client.rpc("squad_my_posts");
    const row = (data ?? []).find((r: { post_id: string }) => r.post_id === post);
    expect(Number(row.reach_count)).toBe(1);
    expect(Object.keys(row)).not.toContain("recipient_student_id");
  });

  it("INVARIANT default-off: squad_my_prefs auto-creates with pings_enabled=false", async () => {
    const a = await authed();
    const { data } = await a.client.rpc("squad_my_prefs");
    expect(data.pings_enabled).toBe(false);
  });

  it("set_prefs rejects out-of-range quiet hours", async () => {
    const a = await authed();
    const { error } = await a.client.rpc("squad_set_prefs", {
      p_pings_enabled: true, p_allowed_categories: null, p_weekly_cap: 3,
      p_quiet_start: 30, p_quiet_end: 9, p_channel: "imessage",
    });
    expect(error).not.toBeNull();
  });

  it("add/remove interest mutates only the caller's signals", async () => {
    const a = await authed();
    await a.client.rpc("squad_add_interest", { p_tag: "kbbq", p_vector: null });
    const { data: sig } = await a.client.rpc("squad_my_signals");
    expect(sig[0].interest_tags).toContain("kbbq");
    await a.client.rpc("squad_remove_interest", { p_tag: "kbbq" });
    const { data: sig2 } = await a.client.rpc("squad_my_signals");
    expect(sig2[0].interest_tags).not.toContain("kbbq");
  });

  it("INVARIANT anon: anonymous callers cannot execute the self-scoped RPCs", async () => {
    const anon = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
    const { error } = await anon.rpc("squad_my_pings");
    expect(error).not.toBeNull();
  });
});
