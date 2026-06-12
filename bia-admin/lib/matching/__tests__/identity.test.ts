// lib/matching/__tests__/identity.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStudentId } from "../identity";

function chain(result: { data: unknown; error: unknown }) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }) };
}

describe("resolveStudentId", () => {
  const getUserById = vi.fn();
  const fromMock = vi.fn();
  const admin = { from: fromMock, auth: { admin: { getUserById } } } as never;

  beforeEach(() => { fromMock.mockReset(); getUserById.mockReset(); });

  it("passes through an existing students.id", async () => {
    fromMock.mockImplementation(() => chain({ data: { id: "s-1" }, error: null }));
    expect(await resolveStudentId(admin, { studentId: "s-1" })).toBe("s-1");
  });

  it("resolves an auth uuid via students.user_id", async () => {
    fromMock.mockImplementation(() => chain({ data: { id: "s-2" }, error: null }));
    expect(await resolveStudentId(admin, { authUserId: "a-9" })).toBe("s-2");
  });

  it("resolves an iMessage handle via students.imessage_id", async () => {
    fromMock.mockImplementation(() => chain({ data: { id: "s-3" }, error: null }));
    expect(await resolveStudentId(admin, { imessageHandle: "+15551234567" })).toBe("s-3");
  });

  it("JIT-creates a students row for an auth user with none (sparse bridge)", async () => {
    let inserted: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "s-new" }, error: null }) }) };
      },
    }));
    getUserById.mockResolvedValue({ data: { user: { id: "a-1", email: "x@usc.edu", user_metadata: { full_name: "Lily" } } }, error: null });
    expect(await resolveStudentId(admin, { authUserId: "a-1" })).toBe("s-new");
    expect(inserted).toMatchObject({ user_id: "a-1", name: "Lily" });
  });

  it("returns null when nothing resolves (unknown handle, no JIT for handles)", async () => {
    fromMock.mockImplementation(() => chain({ data: null, error: null }));
    expect(await resolveStudentId(admin, { imessageHandle: "+10000000000" })).toBeNull();
  });
});
