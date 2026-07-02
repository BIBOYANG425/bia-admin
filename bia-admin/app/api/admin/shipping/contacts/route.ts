// /api/admin/shipping/contacts
// GET   — list all contacts incl. inactive (viewer+)
// PATCH — update a contact by id (value, label, qr_code_url, active, order) (editor+)
// SR-8: zod-validated; qr_code_url must be a real URL (these render on
// uscbia.com). SR-5: audit carries old→new values for the public-facing fields.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

export async function GET() {
  return withRole("viewer", async () => {
    const admin = createBiaServiceRoleClient();
    const { data, error } = await admin
      .from("shipping_contacts")
      .select("*")
      .order("display_order", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "list_failed", details: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json(data ?? []);
  });
}

const PatchContactBody = z.object({
  id: z.string().trim().min(1),
  value: z.string().trim().min(1).max(500).optional(),
  label: z.string().trim().min(1).max(120).optional(),
  label_en: z.string().max(120).nullable().optional(),
  qr_code_url: z
    .string()
    .url()
    .regex(/^https?:\/\//i, "http(s) URL required")
    .max(1000)
    .nullable()
    .optional(),
  active: z.boolean().optional(),
  display_order: z.number().int().min(0).max(10000).optional(),
});

export async function PATCH(request: Request) {
  return withRole("editor", async (auth) => {
    const json = await request.json().catch(() => null);
    const parsed = PatchContactBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { id, ...fields } = parsed.data;

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      patch[key] = typeof value === "string" && value.trim() === "" ? null : value;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();

    const { data: prior } = await admin
      .from("shipping_contacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!prior) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const { data, error } = await admin
      .from("shipping_contacts")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "update_failed", details: error.message },
        { status: 500 },
      );
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(patch)) {
      changes[key] = {
        from: (prior as Record<string, unknown>)[key],
        to: (data as Record<string, unknown>)[key],
      };
    }
    await writeAudit({
      admin_email: auth.user.email,
      action: "shipping_contact.update",
      entity_type: "shipping_contact",
      entity_id: id,
      payload: { id, changes },
    });

    return NextResponse.json(data);
  });
}
