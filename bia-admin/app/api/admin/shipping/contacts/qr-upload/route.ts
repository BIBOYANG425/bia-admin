// /api/admin/shipping/contacts/qr-upload
// POST (multipart) — { file, id } → uploads QR image to the public
// shipping-contact-qr bucket via service-role and returns its public URL.
// editor+. Replaces bia-roommate's browser-side direct upload (Phase-3 slice 8)
// so the write goes through an admin-gated server endpoint.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const MAX_BYTES = 2 * 1024 * 1024;
// Storage-key extension derives from the VALIDATED MIME type — never from the
// client-controlled filename (SR-8).
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function POST(request: Request) {
  return withRole("editor", async (auth) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no_file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "too_large" }, { status: 400 });
    }
    const ext = ALLOWED[file.type];
    if (!ext) {
      return NextResponse.json({ error: "bad_type" }, { status: 400 });
    }

    const id = String(form?.get("id") ?? "contact").replace(/[^a-zA-Z0-9_-]/g, "");
    const path = `qr-${id}-${Date.now()}.${ext}`;

    const admin = createBiaServiceRoleClient();
    const { error } = await admin.storage
      .from("shipping-contact-qr")
      .upload(path, file, { cacheControl: "3600", upsert: true });
    if (error) {
      return NextResponse.json(
        { error: "upload_failed", details: error.message },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = admin.storage.from("shipping-contact-qr").getPublicUrl(path);

    await writeAudit({
      admin_email: auth.user.email,
      action: "shipping_contact.qr_upload",
      entity_type: "shipping_contact",
      entity_id: id,
      payload: { id, path, bucket: "shipping-contact-qr", contentType: file.type },
    });

    return NextResponse.json({ url: publicUrl });
  });
}
