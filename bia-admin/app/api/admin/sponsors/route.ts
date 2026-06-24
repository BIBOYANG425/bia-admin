// /api/admin/sponsors
// GET  — list sponsors (filter by tier + active) ordered by display_order (viewer+).
// POST — create a sponsor (editor+).
// sponsors are bia-admin-owned. Writes go through the service-role client.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const TIERS = ["event", "recruiting", "local_service", "payment"] as const;

const CreateBody = z
  .object({
    name: z.string().min(1).max(200),
    tier: z.enum(TIERS).nullable().optional(),
    contact: z.string().max(500).nullable().optional(),
    logo_url: z.string().max(1000).nullable().optional(),
    website_url: z.string().max(1000).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    display_order: z.number().int().optional(),
  })
  .strip();

export async function GET(request: Request) {
  return withRole("viewer", async () => {
    const url = new URL(request.url);
    const tier = url.searchParams.get("tier");
    const active = url.searchParams.get("active");

    const admin = createBiaServiceRoleClient();
    let query = admin
      .from("sponsors")
      .select("*")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (tier && (TIERS as readonly string[]).includes(tier)) {
      query = query.eq("tier", tier);
    }
    if (active === "true") query = query.eq("active", true);
    else if (active === "false") query = query.eq("active", false);

    const { data, error } = await query.limit(500);
    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json(data ?? []);
  });
}

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = CreateBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const b = parsed.data;
    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("sponsors")
      .insert({
        name: b.name.trim(),
        tier: b.tier ?? null,
        contact: b.contact?.trim() || null,
        logo_url: b.logo_url?.trim() || null,
        website_url: b.website_url?.trim() || null,
        notes: b.notes?.trim() || null,
        active: b.active ?? true,
        display_order: b.display_order ?? 0,
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json(
        { error: "create_failed", details: error.message },
        { status: 500 },
      );
    }

    await writeAudit({
      admin_email: auth.user.email,
      action: "sponsor.create",
      entity_type: "sponsor",
      entity_id: (data?.id as string) ?? null,
      payload: { name: b.name.trim(), tier: b.tier ?? null },
    });

    return NextResponse.json(data);
  });
}
