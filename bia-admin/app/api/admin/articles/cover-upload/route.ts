import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { withRole } from "@/lib/auth/require-role";

const CoverUploadBody = z.object({
  filename: z.string().min(1).max(200),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

const ExtensionByMime: Record<z.infer<typeof CoverUploadBody>["mime"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: Request) {
  return withRole("editor", async () => {
    const json = await request.json().catch(() => null);
    const parsed = CoverUploadBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const path = `cover_${randomUUID()}.${ExtensionByMime[parsed.data.mime]}`;
    const admin = createBiaServiceRoleClient();
    const bucket = admin.storage.from("article-covers");
    const { data, error } = await bucket.createSignedUploadUrl(path);

    if (error || !data) {
      return NextResponse.json(
        { error: "signed_upload_url_failed", details: error?.message },
        { status: 500 },
      );
    }

    const storagePath = data.path ?? path;
    const { data: publicData } = bucket.getPublicUrl(storagePath);

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: storagePath,
      publicUrl: publicData.publicUrl,
    });
  });
}
