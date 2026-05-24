import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  auditMock,
  serviceFromMock,
  maybeSingleMock,
  slugLookupMock,
  updateMock,
  deleteMock,
  sanitizeArticleHtmlMock,
  slugifyMock,
  withCollisionSuffixMock,
  deriveExcerptMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  auditMock: vi.fn(),
  serviceFromMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  slugLookupMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  sanitizeArticleHtmlMock: vi.fn(),
  slugifyMock: vi.fn(),
  withCollisionSuffixMock: vi.fn(),
  deriveExcerptMock: vi.fn(),
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

vi.mock("@biboyang425/bia-shared/articles", () => ({
  sanitizeArticleHtml: sanitizeArticleHtmlMock,
  slugify: slugifyMock,
  withCollisionSuffix: withCollisionSuffixMock,
  deriveExcerpt: deriveExcerptMock,
}));

import { DELETE, GET, PATCH } from "../route";

const editor = {
  user: { id: "u1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "u1", email: "editor@uscbia.com" },
};
const superAdmin = {
  ...editor,
  role: "super_admin" as const,
};

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/articles/article-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupArticleTable() {
  serviceFromMock.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle: maybeSingleMock }),
      in: slugLookupMock,
    }),
    update: updateMock,
    delete: deleteMock,
  });
}

describe("/api/admin/articles/[id]", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    auditMock.mockReset();
    serviceFromMock.mockReset();
    maybeSingleMock.mockReset();
    slugLookupMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    sanitizeArticleHtmlMock.mockReset();
    slugifyMock.mockReset();
    withCollisionSuffixMock.mockReset();
    deriveExcerptMock.mockReset();

    requireRoleMock.mockResolvedValue(editor);
    setupArticleTable();
    sanitizeArticleHtmlMock.mockImplementation((html: string) => html.trim());
    slugifyMock.mockReturnValue("new-title");
    withCollisionSuffixMock.mockImplementation(
      (base: string, taken: Set<string>) => (taken.has(base) ? `${base}-2` : base),
    );
    deriveExcerptMock.mockReturnValue("Derived excerpt");
  });

  it("GET returns one article for viewer+", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1", title: "Welcome", status: "draft" },
      error: null,
    });

    const res = await GET(
      new Request("http://localhost/api/admin/articles/article-1"),
      ctxFor("article-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "article-1",
      title: "Welcome",
      status: "draft",
    });
  });

  it("PATCH rejects published edits from non-super-admins", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "article-1",
        slug: "welcome",
        status: "published",
        title: "Welcome",
      },
      error: null,
    });

    const res = await PATCH(
      makePatchRequest({ title: "New Title" }),
      ctxFor("article-1"),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "published_locked" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("PATCH updates draft fields, regenerates slug, sanitizes html, and audits", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "article-1",
        slug: "old-title",
        status: "draft",
        title: "Old Title",
      },
      error: null,
    });
    slugLookupMock.mockResolvedValue({
      data: [{ id: "article-2", slug: "new-title" }],
      error: null,
    });
    updateMock.mockReturnValue({
      eq: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: "article-1",
                title: "New Title",
                slug: "new-title-2",
                html_clean: "<p>Clean</p>",
              },
              error: null,
            }),
        }),
      }),
    });

    const res = await PATCH(
      makePatchRequest({
        title: "New Title",
        html: "<p>Clean</p>",
        language: "zh",
        tags: ["ai"],
        cover_image_url: null,
      }),
      ctxFor("article-1"),
    );

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Title",
        slug: "new-title-2",
        html_clean: "<p>Clean</p>",
        excerpt: "Derived excerpt",
        language: "zh",
        tags: ["ai"],
        cover_image_url: null,
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "article.update",
        entity_type: "article",
        entity_id: "article-1",
      }),
    );
  });

  it("DELETE returns 403 when auth rejects super_admin requirement", async () => {
    const { RoleError } = await import("@/lib/auth/require-role");
    requireRoleMock.mockRejectedValue(
      new RoleError(403, "role_required: super_admin"),
    );

    const res = await DELETE(
      new Request("http://localhost/api/admin/articles/article-1", {
        method: "DELETE",
      }),
      ctxFor("article-1"),
    );

    expect(res.status).toBe(403);
  });

  it("DELETE removes article and audits for super_admin", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({
      data: { id: "article-1" },
      error: null,
    });
    deleteMock.mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });

    const res = await DELETE(
      new Request("http://localhost/api/admin/articles/article-1", {
        method: "DELETE",
      }),
      ctxFor("article-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_email: "editor@uscbia.com",
        action: "article.delete",
        entity_type: "article",
        entity_id: "article-1",
      }),
    );
  });

  it("DELETE returns 404 when article does not exist and skips audit", async () => {
    requireRoleMock.mockResolvedValue(superAdmin);
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await DELETE(
      new Request("http://localhost/api/admin/articles/missing-id", {
        method: "DELETE",
      }),
      ctxFor("missing-id"),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});
