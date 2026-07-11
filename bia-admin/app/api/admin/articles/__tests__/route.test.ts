import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireRoleMock,
  auditMock,
  serviceFromMock,
  sanitizeArticleHtmlMock,
  slugifyMock,
  withCollisionSuffixMock,
  deriveExcerptMock,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  auditMock: vi.fn(),
  serviceFromMock: vi.fn(),
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
  // Pass-through for the post-sanitize empty-image strip. Tests that care
  // about the strip behavior live in the shared package.
  stripEmptyImages: (html: string) => html,
}));

import { POST } from "../route";

const auth = {
  user: { id: "u1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "u1", email: "editor@uscbia.com" },
};

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/admin/articles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/articles", () => {
  beforeEach(() => {
    requireRoleMock.mockReset();
    auditMock.mockReset();
    serviceFromMock.mockReset();
    sanitizeArticleHtmlMock.mockReset();
    slugifyMock.mockReset();
    withCollisionSuffixMock.mockReset();
    deriveExcerptMock.mockReset();

    requireRoleMock.mockResolvedValue(auth);
    sanitizeArticleHtmlMock.mockImplementation((html: string) => html.trim());
    slugifyMock.mockReturnValue("welcome-to-bia");
    withCollisionSuffixMock.mockImplementation(
      (base: string, taken: Set<string>) => (taken.has(base) ? `${base}-2` : base),
    );
    deriveExcerptMock.mockReturnValue("Welcome excerpt");
  });

  it("POST creates a sanitized draft with derived excerpt, cover, slug, and audit", async () => {
    const slugLookupMock = vi.fn().mockResolvedValue({
      // Non-draft row collides; draft-status rows are filtered out so they don't
      // count as collisions for new draft creation.
      data: [{ slug: "welcome-to-bia", status: "published" }],
      error: null,
    });
    const insertMock = vi.fn().mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: {
              id: "article-1",
              slug: "welcome-to-bia-2",
              language: "en",
              status: "draft",
            },
            error: null,
          }),
      }),
    });

    serviceFromMock.mockReturnValue({
      select: () => ({ in: slugLookupMock }),
      insert: insertMock,
    });

    const res = await POST(
      makePostRequest({
        title: "Welcome to BIA",
        html: "<p>Welcome</p>",
        language: "en",
        tags: ["career"],
        cover_image_url: "https://cdn.example.com/cover.jpg",
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: "article-1",
      slug: "welcome-to-bia-2",
      status: "draft",
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "welcome-to-bia-2",
        html_clean: "<p>Welcome</p>",
        excerpt: "Welcome excerpt",
        cover_image_url: "https://cdn.example.com/cover.jpg",
        author_id: "u1",
        status: "draft",
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_email: "editor@uscbia.com",
        action: "article.create",
        entity_type: "article",
        entity_id: "article-1",
      }),
    );
  });

  it("POST returns 400 on invalid body", async () => {
    const res = await POST(
      makePostRequest({ title: "", html: "", language: "fr" }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("POST returns 401 when auth rejects", async () => {
    const { RoleError } = await import("@/lib/auth/require-role");
    requireRoleMock.mockRejectedValue(new RoleError(401, "no_session"));

    const res = await POST(
      makePostRequest({
        title: "Welcome",
        html: "<p>Welcome</p>",
        language: "en",
      }),
    );

    expect(res.status).toBe(401);
  });

});
