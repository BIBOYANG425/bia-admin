import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, uploadMock, getPublicUrlMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  uploadMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_min: unknown, handler: any) => {
    try {
      return await handler(await requireRoleMock());
    } catch (error: any) {
      if (typeof error?.status === "number" && typeof error?.code === "string") {
        const { NextResponse } = await import("next/server");
        return NextResponse.json({ error: error.code }, { status: error.status });
      }
      throw error;
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
      from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }),
    },
  }),
}));

import { POST } from "../route";

const editor = {
  user: { id: "admin-2", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "admin-2", email: "editor@uscbia.com" },
};

function uploadReq(form: FormData) {
  return new Request("http://localhost/api/admin/shipping/contacts/qr-upload", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/admin/shipping/contacts/qr-upload", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    uploadMock.mockReset();
    getPublicUrlMock.mockReset();
    requireRoleMock.mockResolvedValue(editor);
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({
      data: { publicUrl: "https://store/qr-c1.png" },
    });
  });

  it("rejects a request with no file", async () => {
    const form = new FormData();
    form.append("id", "c1");
    const res = await POST(uploadReq(form));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_file" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects a non-image content type", async () => {
    const form = new FormData();
    form.append("file", new File(["x"], "bad.pdf", { type: "application/pdf" }));
    const res = await POST(uploadReq(form));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_type" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects a file larger than 2MB", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });
    const form = new FormData();
    form.append("file", big);
    const res = await POST(uploadReq(form));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_large" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("uploads a valid PNG and returns its public URL", async () => {
    const form = new FormData();
    form.append("file", new File(["png-bytes"], "qr.png", { type: "image/png" }));
    form.append("id", "c1");
    const res = await POST(uploadReq(form));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://store/qr-c1.png" });
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a storage upload error as 500", async () => {
    uploadMock.mockResolvedValue({ error: { message: "storage down" } });
    const form = new FormData();
    form.append("file", new File(["x"], "qr.webp", { type: "image/webp" }));
    const res = await POST(uploadReq(form));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("upload_failed");
  });
});
