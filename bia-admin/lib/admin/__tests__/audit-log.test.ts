import { describe, expect, it, vi, beforeEach } from "vitest";

const { insertMock, createClientMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@biboyang425/bia-shared/supabase/service-role", () => ({
  createBiaServiceRoleClient: createClientMock,
}));

import { writeAudit, writeAuditRequired } from "../audit-log";

describe("writeAudit", () => {
  beforeEach(() => {
    insertMock.mockReset();
    createClientMock.mockReturnValue({
      from: () => ({
        insert: insertMock,
      }),
    });
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

  it("does not throw when createBiaServiceRoleClient throws", async () => {
    createClientMock.mockImplementation(() => {
      throw new Error("client init failed");
    });

    await expect(
      writeAudit({
        admin_email: "bobby@uscbia.com",
        action: "article.create",
        entity_type: "article",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("writeAuditRequired", () => {
  beforeEach(() => {
    insertMock.mockReset();
    createClientMock.mockReturnValue({
      from: () => ({ insert: insertMock }),
    });
  });

  it("rejects when the durable insert fails", async () => {
    insertMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(
      writeAuditRequired({
        admin_email: "bobby@uscbia.com",
        action: "admin_removed",
        entity_type: "admin_user",
      }),
    ).rejects.toThrow("audit_write_failed: boom");
  });
});
