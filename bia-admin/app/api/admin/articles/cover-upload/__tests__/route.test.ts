import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  createSignedUploadUrlMock,
  getPublicUrlMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  createSignedUploadUrlMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_min: unknown, handler: any) => {
    try {
      return await handler(await requireRoleMock());
    } catch (error: any) {
      const { NextResponse } = await import("next/server");
      return NextResponse.json(
        { error: error.code ?? "unknown" },
        { status: error.status ?? 500 },
      );
    }
  },
  RoleError: class RoleError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: createSignedUploadUrlMock,
        getPublicUrl: getPublicUrlMock,
      }),
    },
  }),
}));

import { POST } from "../route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/admin/articles/cover-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/articles/cover-upload", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    createSignedUploadUrlMock.mockReset();
    getPublicUrlMock.mockReset();

    requireRoleMock.mockResolvedValue({
      user: { id: "u1", email: "editor@uscbia.com" },
      role: "editor",
      adminUser: { id: "u1" },
    });
    createSignedUploadUrlMock.mockResolvedValue({
      data: {
        signedUrl: "https://signed.example.com/upload",
        token: "upload-token",
        path: "cover_generated.jpg",
      },
      error: null,
    });
    getPublicUrlMock.mockReturnValue({
      data: {
        publicUrl:
          "https://project.supabase.co/storage/v1/object/public/article-covers/cover_generated.jpg",
      },
    });
  });

  it("returns signed upload data plus public URL", async () => {
    const res = await POST(
      makeRequest({ filename: "hero.jpg", mime: "image/jpeg" }),
    );

    expect(res.status).toBe(200);
    expect(createSignedUploadUrlMock).toHaveBeenCalledWith(
      expect.stringMatching(/^cover_[^.]+\.jpg$/),
    );
    expect(getPublicUrlMock).toHaveBeenCalledWith("cover_generated.jpg");
    expect(await res.json()).toEqual({
      signedUrl: "https://signed.example.com/upload",
      token: "upload-token",
      path: "cover_generated.jpg",
      publicUrl:
        "https://project.supabase.co/storage/v1/object/public/article-covers/cover_generated.jpg",
    });
  });

  it("returns 400 for unsupported MIME types", async () => {
    const res = await POST(
      makeRequest({ filename: "payload.exe", mime: "application/octet-stream" }),
    );

    expect(res.status).toBe(400);
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled();
  });

  it("returns 500 if Supabase cannot mint the signed upload URL", async () => {
    createSignedUploadUrlMock.mockResolvedValue({
      data: null,
      error: { message: "storage unavailable" },
    });

    const res = await POST(
      makeRequest({ filename: "hero.png", mime: "image/png" }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "signed_upload_url_failed",
      details: "storage unavailable",
    });
  });
});
