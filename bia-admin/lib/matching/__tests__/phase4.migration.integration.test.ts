// lib/matching/__tests__/phase4.migration.integration.test.ts
// Run: RUN_DB_TESTS=true pnpm exec vitest run lib/matching/__tests__/phase4.migration.integration.test.ts
// Needs .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";

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
const ids = { posts: [] as string[], students: [] as string[] };

beforeAll(() => {
  if (!RUN) return;
  admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
});

afterAll(async () => {
  if (!RUN) return;
  if (ids.posts.length) await admin.from("squad_posts").delete().in("id", ids.posts);
  if (ids.students.length) await admin.from("students").delete().in("id", ids.students);
});

d("squad phase 4 migration", () => {
  it("squad_posts has needs_refill defaulting false + reminder/completed null", async () => {
    const { data, error } = await admin.from("squad_posts").insert({
      poster_name: "p4test", category: "其它", content: "p4 migration test", contact: "x",
      max_people: 4, current_people: 1,
    }).select("id, needs_refill, reminder_sent_at, completed_at").single();
    expect(error).toBeNull();
    ids.posts.push(data!.id);
    expect(data!.needs_refill).toBe(false);
    expect(data!.reminder_sent_at).toBeNull();
    expect(data!.completed_at).toBeNull();
  });

  it("squad_members.rsvp_status defaults 'pending' and rejects an invalid value", async () => {
    const { data: s } = await admin.from("students").insert({ name: "p4member" }).select("id").single();
    ids.students.push(s!.id);
    const { data: post } = await admin.from("squad_posts").insert({
      poster_name: "p4test", category: "其它", content: "p4 member test", contact: "x",
      max_people: 4, current_people: 1,
    }).select("id").single();
    ids.posts.push(post!.id);

    const ok = await admin.from("squad_members")
      .insert({ post_id: post!.id, student_id: s!.id }).select("rsvp_status").single();
    expect(ok.error).toBeNull();
    expect(ok.data!.rsvp_status).toBe("pending");

    const bad = await admin.from("squad_members")
      .update({ rsvp_status: "dropped_out" }).eq("post_id", post!.id).eq("student_id", s!.id);
    expect(bad.error).not.toBeNull(); // CHECK rejects anything outside pending/confirmed
  });
});
