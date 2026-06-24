import { describe, expect, it, vi, beforeEach } from "vitest";

const { insertMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
}));

vi.mock("@biboyang425/bia-shared", () => ({
  createBiaServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}));

import { writeAudit } from "../audit-log";

describe("writeAudit", () => {
  beforeEach(() => {
    insertMock.mockReset();
  });

  it("inserts admin_audit_log row fields", async () => {
    insertMock.mockResolvedValue({ data: null, error: null });

    await writeAudit({
      admin_email: "bobby@uscbia.com",
      action: "article.publish",
      entity_type: "article",
      entity_id: "article-1",
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

  it("defaults entity_id to null and payload to an empty object", async () => {
    insertMock.mockResolvedValue({ data: null, error: null });

    await writeAudit({
      admin_email: "bobby@uscbia.com",
      action: "article.create",
      entity_type: "article",
    });

    expect(insertMock).toHaveBeenCalledWith({
      admin_email: "bobby@uscbia.com",
      action: "article.create",
      entity_type: "article",
      entity_id: null,
      payload: {},
    });
  });

  it("does not throw when the insert returns an error", async () => {
    insertMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(
      writeAudit({
        admin_email: "bobby@uscbia.com",
        action: "article.create",
        entity_type: "article",
      }),
    ).resolves.toBeUndefined();
  });
});
