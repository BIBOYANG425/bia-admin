// /api/admin/shipping/contacts
// GET   — list all contacts incl. inactive (viewer+)
// PATCH — update a contact by id (value, label, qr_code_url, active, order) (editor+)
// Ported from bia-roommate /api/shipping/admin/contacts (Phase-3 slice 8):
// requireAdmin -> withRole, createAdminSupabaseClient -> createBiaServiceRoleClient.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { logAdminAction } from "@/lib/audit/log";

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

export async function PATCH(request: Request) {
  return withRole("editor", async (auth) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "id_required" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.value === "string") patch.value = body.value;
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.label_en === "string" || body.label_en === null) {
      patch.label_en = body.label_en || null;
    }
    if (typeof body.qr_code_url === "string" || body.qr_code_url === null) {
      patch.qr_code_url = body.qr_code_url || null;
    }
    if (typeof body.active === "boolean") patch.active = body.active;
    if (typeof body.display_order === "number") {
      patch.display_order = body.display_order;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }

    const admin = createBiaServiceRoleClient();
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

    await logAdminAction({
      adminEmail: auth.user.email,
      action: "shipping_contact.update",
      entityType: "shipping_contact",
      entityId: id,
      payload: { fields: Object.keys(patch) },
    });

    return NextResponse.json(data);
  });
}
