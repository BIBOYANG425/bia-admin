// /api/admin/sponsors/logo-upload
// POST (multipart) — { file, id? } → uploads a sponsor logo to the public
// sponsor-logos bucket via service-role and returns its public URL. editor+.
// Mirrors the shipping contact qr-upload route.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

const MAX_BYTES = 2 * 1024 * 1024;
// Derive the stored extension from the validated MIME type, not file.name —
// `'logo'.split('.').pop()` returns the whole name (the `|| "png"` fallback is
// unreachable for extension-less files).
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const ALLOWED = new Set(Object.keys(EXT_BY_TYPE));

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
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "bad_type" }, { status: 400 });
    }

    const id = String(form?.get("id") ?? "sponsor").replace(
      /[^a-zA-Z0-9_-]/g,
      "",
    );
    const ext = EXT_BY_TYPE[file.type] ?? "png";
    const path = `logo-${id || "sponsor"}-${Date.now()}.${ext}`;

    const admin = createBiaServiceRoleClient();
    const { error } = await admin.storage
      .from("sponsor-logos")
      .upload(path, file, { cacheControl: "3600", upsert: true });
    if (error) {
      return NextResponse.json(
        { error: "upload_failed", details: error.message },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = admin.storage.from("sponsor-logos").getPublicUrl(path);

    await writeAudit({
      admin_email: auth.user.email,
      action: "sponsor.logo_upload",
      entity_type: "sponsor",
      entity_id: id || null,
      payload: { id, path, bucket: "sponsor-logos", contentType: file.type },
    });

    return NextResponse.json({ url: publicUrl });
  });
}
