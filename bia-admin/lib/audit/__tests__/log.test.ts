import { describe, expect, it, vi, beforeEach } from "vitest";

const { insertMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
}));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}));

import { logAdminAction } from "../log";

describe("logAdminAction", () => {
  beforeEach(() => {
    insertMock.mockReset();
  });

  it("inserts admin_audit_log row fields", async () => {
    insertMock.mockResolvedValue({ data: null, error: null });

    await logAdminAction({
      adminEmail: "bobby@uscbia.com",
      action: "article.publish",
      entityType: "article",
      entityId: "article-1",
      payload: { slug: "welcome" },
    });

    expect(insertMock).toHaveBeenCalledWith({
      admin_email: "bobby@uscbia.com",
      action: "article.publish",
      entity_type: "article",
      entity_id: "article-1",
      payload: { slug: "welcome" },
    });
  });

  it("does not throw when the insert returns an error", async () => {
    insertMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(
      logAdminAction({
        adminEmail: "bobby@uscbia.com",
        action: "article.create",
        entityType: "article",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when the insert throws", async () => {
    insertMock.mockRejectedValue(new Error("network"));

    await expect(
      logAdminAction({
        adminEmail: "bobby@uscbia.com",
        action: "article.delete",
        entityType: "article",
        entityId: "article-1",
      }),
    ).resolves.toBeUndefined();
  });
});
