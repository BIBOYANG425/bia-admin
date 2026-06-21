// /api/admin/shipping/parcels/match
// POST { codes: string[] } — resolve CN tracking numbers to 'expected' parcels
// for bulk intake. Read-only (viewer+); never mutates. Returns matched /
// unmatched / ambiguous so the officer can confirm before receiving.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";

const Body = z.object({
  codes: z.array(z.string()).min(1).max(300),
});

interface MatchParcel {
  id: string;
  member_id: string;
  description: string;
  tracking_cn: string | null;
  weight_grams: number | null;
}

export async function POST(request: Request) {
  return withRole("viewer", async () => {
    const json = await request.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "请粘贴单号" }, { status: 400 });
    }

    const codes = Array.from(
      new Set(parsed.data.codes.map((c) => c.trim()).filter(Boolean)),
    );
    if (codes.length === 0) {
      return NextResponse.json({ error: "请粘贴单号" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
    const { data: parcels, error } = await admin
      .from("parcels")
      .select("id, member_id, description, tracking_cn, weight_grams")
      .in("tracking_cn", codes)
      .eq("status", "expected");

    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }

    const byCode = new Map<string, MatchParcel[]>();
    for (const p of (parcels ?? []) as MatchParcel[]) {
      const key = p.tracking_cn ?? "";
      const arr = byCode.get(key) ?? [];
      arr.push(p);
      byCode.set(key, arr);
    }

    const matched: MatchParcel[] = [];
    const ambiguous: Array<{ code: string; ids: string[] }> = [];
    const unmatched: string[] = [];
    for (const code of codes) {
      const arr = byCode.get(code);
      if (!arr || arr.length === 0) unmatched.push(code);
      else if (arr.length === 1) matched.push(arr[0]);
      else ambiguous.push({ code, ids: arr.map((p) => p.id) });
    }

    return NextResponse.json({ matched, unmatched, ambiguous });
  });
}
