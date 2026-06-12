// lib/matching/__tests__/rpc.integration.test.ts
// Run: RUN_DB_TESTS=true pnpm exec vitest run lib/matching/__tests__/rpc.integration.test.ts
// Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY.
//
// EMBED-UNAVAILABLE ADAPTATION (spec §11):
// The plan's mkStudent/mkPost helpers call makeEmbedClient() which requires OPENAI_API_KEY + a
// deployed embed function. Since OPENAI_API_KEY may be absent or embed may not be deployed,
// we insert deterministic fake vectors directly via SQL:
//   - "similar" pair: two near-parallel 1536-dim vectors (cosine ≈ 1.0)
//   - "orthogonal" vector: unit vector on a perpendicular axis (cosine ≈ 0.0 to similar pair)
// The bilingual rank test (INVARIANT #bilingual) uses the live embed function and is marked
// it.skip("pending OPENAI_API_KEY") — enable by adding the key to .env.local.
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

// ---------------------------------------------------------------------------
// Deterministic fake vectors — no OPENAI_API_KEY needed
// ---------------------------------------------------------------------------

// "korean food" user: mostly axis 0 (dim=1536). Cosine with post ≈ 1.0.
function makeKoreanVec(): number[] {
  const v = new Array(1536).fill(0);
  v[0] = 1.0;
  return v;
}

// Post vector: same axis as korean vec → cosine = 1.0 with makeKoreanVec.
function makePostVec(): number[] {
  return makeKoreanVec();
}

// "calculus only" user: orthogonal to axis 0 → cosine ≈ 0 with korean vec.
function makeOrthogonalVec(): number[] {
  const v = new Array(1536).fill(0);
  v[1] = 1.0;
  return v;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let admin: SupabaseClient;
let anon: SupabaseClient;
const ids = { students: [] as string[], posts: [] as string[] };

// Insert a student + optional interest_vectors + match_prefs using fake vecs (no embed call).
async function mkStudentFakeVec(
  name: string,
  tags: string[],
  facetVectors: Array<{ label: string; vec: number[] }>,
  pings: boolean,
): Promise<string> {
  const { data: s, error } = await admin
    .from("students")
    .insert({ name, interest_tags: tags })
    .select()
    .single();
  if (error) throw error;
  ids.students.push(s.id);

  if (facetVectors.length) {
    const rows = facetVectors.map(({ label, vec }) => ({
      student_id: s.id,
      label,
      // pgvector accepts a JSON-array literal cast as vector
      vector: JSON.stringify(vec),
    }));
    const { error: vErr } = await admin.from("user_interest_vectors").insert(rows);
    if (vErr) throw vErr;
  }

  const { error: pErr } = await admin
    .from("user_match_prefs")
    .upsert({ student_id: s.id, pings_enabled: pings });
  if (pErr) throw pErr;

  return s.id as string;
}

// Insert a post with a fake embedding (no embed call).
async function mkPostFakeVec(
  content: string,
  tags: string[],
  vec: number[],
  opts: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const { data: p, error } = await admin
    .from("squad_posts")
    .insert({
      poster_name: "itest",
      category: "其它",
      content,
      contact: "itest",
      max_people: 4,
      current_people: 1,
      tags,
      embedding: JSON.stringify(vec),
      ...opts,
    })
    .select()
    .single();
  if (error) throw error;
  ids.posts.push(p.id);
  return p.id as string;
}

// Insert a post with NO embedding (tag-only fixture for consent/gate test).
async function mkPostTagOnly(
  content: string,
  tags: string[],
  opts: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const { data: p, error } = await admin
    .from("squad_posts")
    .insert({
      poster_name: "itest",
      category: "其它",
      content,
      contact: "itest",
      max_people: 4,
      current_people: 1,
      tags,
      ...opts,
    })
    .select()
    .single();
  if (error) throw error;
  ids.posts.push(p.id);
  return p.id as string;
}

beforeAll(() => {
  admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  anon = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
});

afterAll(async () => {
  if (!RUN) return;
  // Clean up in FK-safe order: prefs + vectors reference students; pings + posts can be independent.
  if (ids.students.length) {
    await admin.from("user_match_prefs").delete().in("student_id", ids.students);
    await admin.from("user_interest_vectors").delete().in("student_id", ids.students);
    await admin.from("students").delete().in("id", ids.students);
  }
  if (ids.posts.length) {
    await admin.from("squad_posts").delete().in("id", ids.posts);
  }
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

d("matching engine integration", () => {
  it("INVARIANT #5: matching tables are unreadable with the anon key (deny-all RLS)", async () => {
    for (const t of ["user_interest_vectors", "user_match_prefs", "squad_pings"]) {
      const { data, error } = await anon.from(t).select("*").limit(1);
      // deny-all RLS returns an empty result set (or an error) — never rows.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });

  it("INVARIANT #8: status view derives full/expired/open/closed at boundaries", async () => {
    const open = await mkPostTagOnly("status open", []);
    const full = await mkPostTagOnly("status full", [], { max_people: 2, current_people: 2 });
    const expired = await mkPostTagOnly("status expired", [], {
      deadline: new Date(Date.now() - 3600e3).toISOString(),
    });
    const closed = await mkPostTagOnly("status closed", [], {
      cancelled_at: new Date().toISOString(),
    });

    const { data } = await admin
      .from("squad_posts_with_status")
      .select("id,status")
      .in("id", [open, full, expired, closed]);

    const by = Object.fromEntries((data ?? []).map((r: { id: string; status: string }) => [r.id, r.status]));
    expect(by[open]).toBe("open");
    expect(by[full]).toBe("full");
    expect(by[expired]).toBe("expired");
    expect(by[closed]).toBe("closed");
  });

  it("INVARIANT #1 + gate: opted-out users are NEVER returned; weak matches don't clear the floor", async () => {
    // opted-in: korean_food tag + similar vector → should appear
    const optedIn = await mkStudentFakeVec(
      "itest-in",
      ["korean_food"],
      [{ label: "korean_food", vec: makeKoreanVec() }],
      true,
    );
    // opted-out: same tags/vector but pings_enabled=false → must NOT appear
    const optedOut = await mkStudentFakeVec(
      "itest-out",
      ["korean_food"],
      [{ label: "korean_food", vec: makeKoreanVec() }],
      false,
    );
    // weak: orthogonal vector + unrelated tag → must NOT appear (pre-fusion floor)
    const weak = await mkStudentFakeVec(
      "itest-weak",
      ["calculus"],
      [{ label: "calculus", vec: makeOrthogonalVec() }],
      true,
    );

    // Post with matching tag + similar vector
    const post = await mkPostFakeVec(
      "周五晚 K-town 韩式烤肉 3缺2",
      ["korean_food", "kbbq"],
      makePostVec(),
    );

    const { data, error } = await admin.rpc("match_users_for_post", { p_post_id: post });
    expect(error).toBeNull();
    const got = ((data as { student_id: string }[]) ?? []).map((r) => r.student_id);
    expect(got).toContain(optedIn);
    expect(got).not.toContain(optedOut); // consent gate at SQL layer
    expect(got).not.toContain(weak);    // pre-fusion floors
  });

  // Bilingual test uses the REAL embed function (OPENAI_API_KEY + deployed embed required).
  // Fixture design: zero tag overlap and no lexical match between the user's tags and the
  // posts' content/tags — so the tag and fts legs are silent and ONLY the semantic leg can
  // produce the ranking. This is the cross-language property the multilingual model was
  // chosen for (spec §6.4).
  it("BILINGUAL + rank order: 韩烤 post ranks the korean-food user's board above an unrelated post (semantic leg only)", async () => {
    const { makeEmbedClient } = await import("../embed-client");
    const embed = makeEmbedClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

    const [userVec, kpostVec, runVec] = await embed([
      "korean bbq, kbbq, 韩式烤肉 — loves korean barbecue nights",
      "其它: 周五晚去吃韩烤 有人吗",
      "其它: saturday morning trail running crew",
    ]);

    const lily = await mkStudentFakeVec("itest-lily-bilingual", ["korean_food"],
      [{ label: "korean_food", vec: userVec }], true);
    const kpost = await mkPostFakeVec("周五晚去吃韩烤 有人吗", ["food"], kpostVec);
    const other = await mkPostFakeVec("saturday morning trail running crew", ["running"], runVec);

    const { data, error } = await admin.rpc("hybrid_search_posts_for_user", { p_student_id: lily });
    expect(error).toBeNull();
    const ranked = ((data as { post_id: string }[]) ?? []).map((r) => r.post_id);
    expect(ranked).toContain(kpost);
    const otherIdx = ranked.indexOf(other);
    expect(ranked.indexOf(kpost)).toBeLessThan(otherIdx === -1 ? Infinity : otherIdx);
  }, 30_000);
});
