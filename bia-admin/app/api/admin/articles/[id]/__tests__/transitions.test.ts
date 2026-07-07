import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  auditMock,
  serviceFromMock,
  maybeSingleMock,
  slugLookupMock,
  updateMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  auditMock: vi.fn(),
  serviceFromMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  slugLookupMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({
  withRole: async (_min: unknown, handler: any) => {
    try {
      return await handler(await requireRoleMock());
    } catch (error: any) {
      // Only convert auth-shaped errors (RoleError) to JSON responses.
      // Anything else should surface as a thrown error so tests catch bugs.
      if (typeof error?.status === "number" && typeof error?.code === "string") {
        const { NextResponse } = await import("next/server");
        return NextResponse.json(
          { error: error.code },
          { status: error.status },
        );
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

vi.mock("@/lib/admin/audit-log", () => ({
  writeAudit: auditMock,
}));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({
    from: serviceFromMock,
  }),
}));

import { POST as publish } from "../publish/route";
import { POST as reject } from "../reject/route";
import { POST as submit } from "../submit/route";
import { POST as unpublish } from "../unpublish/route";

const editor = {
  user: { id: "u1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "u1", email: "editor@uscbia.com" },
};
const superAdmin = {
  ...editor,
  role: "super_admin" as const,
};

function request(body?: unknown) {
  return new Request("http://localhost/api/admin/articles/article-1/transition", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx() {
  return { params: Promise.resolve({ id: "article-1" }) };
}

function setupArticleTable() {
  serviceFromMock.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle: maybeSingleMock }),
      in: slugLookupMock,
    }),
    update: updateMock,
  });
}

function updateOk(returned: Record<string, unknown>) {
  updateMock.mockReturnValue({
    eq: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: returned, error: null }),
      }),
    }),
  });
}

describe("article transitions", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    auditMock.mockReset();
    serviceFromMock.mockReset();
    maybeSingleMock.mockReset();
    slugLookupMock.mockReset();
    updateMock.mockReset();

    requireRoleMock.mockResolvedValue(editor);
    setupArticleTable();
    // Default: no slug collisions.
    slugLookupMock.mockResolvedValue({ data: [], error: null });
  });

  it("submit transitions draft to in_review and audits", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "draft", slug: "welcome" },
      error: null,
    });
    updateOk({ id: "article-1", status: "in_review", slug: "welcome" });

    const res = await submit(request(), ctx());

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "welcome",
        status: "in_review",
        submitted_by: "u1",
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "article.submit" }),
    );
  });

  it("submit bumps slug suffix when a non-draft article already owns the slug", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "draft", slug: "welcome" },
      error: null,
    });
    slugLookupMock.mockResolvedValue({
      data: [{ id: "article-2", slug: "welcome", status: "published" }],
      error: null,
    });
    updateOk({ id: "article-1", status: "in_review", slug: "welcome-2" });

    const res = await submit(request(), ctx());

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "welcome-2",
        status: "in_review",
      }),
    );
  });

  it("submit rejects non-draft source status", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "published", slug: "welcome" },
      error: null,
    });

    const res = await submit(request(), ctx());

    expect(res.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("reject requires super_admin through withRole", async () => {
    const { RoleError } = await import("@/lib/auth/require-role");
    requireRoleMock.mockRejectedValue(
      new RoleError(403, "role_required: super_admin"),
    );

    const res = await reject(request({ reason: "Needs polish" }), ctx());

    expect(res.status).toBe(403);
  });

  it("reject transitions in_review to draft, clears submit fields, and audits", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "in_review" },
      error: null,
    });
    updateOk({ id: "article-1", status: "draft" });

    const res = await reject(request({ reason: "Needs polish" }), ctx());

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "draft",
        submitted_at: null,
        submitted_by: null,
        rejected_by: "u1",
        rejection_reason: "Needs polish",
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "article.reject",
        payload: { reason: "Needs polish" },
      }),
    );
  });

  it("publish transitions in_review to published and clears unpublished fields", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "in_review", slug: "welcome" },
      error: null,
    });
    updateOk({ id: "article-1", status: "published" });

    const res = await publish(request(), ctx());

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "published",
        published_by: "u1",
        unpublished_at: null,
        unpublished_by: null,
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "article.publish",
        payload: { slug: "welcome" },
      }),
    );
  });

  it("publish allows unpublished to published", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "unpublished", slug: "welcome" },
      error: null,
    });
    updateOk({ id: "article-1", status: "published" });

    const res = await publish(request(), ctx());

    expect(res.status).toBe(200);
  });

  it("publish does not rewrite slug (DB partial unique index owns the guarantee)", async () => {
    // The app-layer slug bump was removed from the publish route.
    // The DB partial unique index (migration 20260524000003) covers
    // in_review/published/unpublished — submit already bumped if needed.
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "in_review", slug: "welcome" },
      error: null,
    });
    updateOk({ id: "article-1", status: "published", slug: "welcome" });

    const res = await publish(request(), ctx());

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "published",
      }),
    );
    // slug must NOT be written by the publish update (no app-layer bump).
    expect(updateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ slug: expect.anything() }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "article.publish",
        payload: { slug: "welcome" },
      }),
    );
  });

  it("publish rejects draft source status", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "draft", slug: "welcome" },
      error: null,
    });

    const res = await publish(request(), ctx());

    expect(res.status).toBe(409);
  });

  it("unpublish transitions published to unpublished and audits", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "published" },
      error: null,
    });
    updateOk({ id: "article-1", status: "unpublished" });

    const res = await unpublish(request(), ctx());

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unpublished",
        unpublished_by: "u1",
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "article.unpublish" }),
    );
  });

  it("unpublish rejects draft source status", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", status: "draft" },
      error: null,
    });

    const res = await unpublish(request(), ctx());

    expect(res.status).toBe(409);
  });
});
