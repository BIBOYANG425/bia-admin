// lib/matching/__tests__/vector-builder.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildUserVectors } from "../vector-builder";

const FACETS = [
  { label: "korean_food", text: "loves kbbq" },
  { label: "hiking", text: "weekend hikes" },
];
const VEC = Array(1536).fill(0.01);

function makeAdmin() {
  const upserts: unknown[] = [];
  const deletes: unknown[] = [];
  const updates: unknown[] = [];
  const admin = {
    from: vi.fn((table: string) => ({
      upsert: (rows: unknown) => { upserts.push({ table, rows }); return Promise.resolve({ error: null }); },
      update: (row: unknown) => ({ eq: () => { updates.push({ table, row }); return Promise.resolve({ error: null }); } }),
      delete: () => ({ eq: () => ({ not: () => { deletes.push(table); return Promise.resolve({ error: null }); } }) }),
    })),
  };
  return { admin: admin as never, upserts, deletes, updates };
}

describe("buildUserVectors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes tags and upserts one vector per facet, pruning stale labels", async () => {
    const { admin, upserts, deletes, updates } = makeAdmin();
    const embed = vi.fn().mockResolvedValue([VEC, VEC]);
    const res = await buildUserVectors(admin, "s-1", { tags: ["kbbq"], facets: FACETS }, embed);
    expect(res).toEqual({ studentId: "s-1", tags: 1, facets: 2, embedded: true });
    expect(updates.some((u: any) => u.table === "students")).toBe(true);
    expect(upserts.some((u: any) => u.table === "user_interest_vectors")).toBe(true);
    expect(deletes).toContain("user_interest_vectors"); // stale-label prune
    expect(embed).toHaveBeenCalledWith(FACETS.map((f) => `${f.label}: ${f.text}`));
  });

  it("embed failure → tags still written, vectors skipped, embedded=false (spec §11 fallback)", async () => {
    const { admin, upserts, updates } = makeAdmin();
    const embed = vi.fn().mockRejectedValue(new Error("embed_unavailable"));
    const res = await buildUserVectors(admin, "s-1", { tags: ["kbbq"], facets: FACETS }, embed);
    expect(res.embedded).toBe(false);
    expect(updates.length).toBe(1);              // tags written
    expect(upserts.length).toBe(0);              // no vectors
  });
});
