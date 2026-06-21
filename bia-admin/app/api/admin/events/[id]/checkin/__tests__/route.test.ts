import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
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
  createBiaServiceRoleClient: () => ({ from: fromMock }),
}));

import { POST } from "../route";

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};
const SID = "00000000-0000-0000-0000-000000000001";

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new Request("http://localhost/api/admin/events/e1/checkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Result = { data: unknown[] | null; error: { message: string } | null };

/** Thenable filter chain: .eq/.is/.not return the chain, .select / await resolve it. */
function chain(result: Result, filters?: Array<[string, ...unknown[]]>) {
  const c: any = {
    eq: (...args: unknown[]) => {
      filters?.push(["eq", ...args]);
      return c;
    },
    is: (...args: unknown[]) => {
      filters?.push(["is", ...args]);
      return c;
    },
    not: (...args: unknown[]) => {
      filters?.push(["not", ...args]);
      return c;
    },
    select: () => Promise.resolve(result),
    then: (onOk: any, onErr: any) => Promise.resolve(result).then(onOk, onErr),
  };
  return c;
}

/** Read chain for the existence probe: .eq() chains, .maybeSingle() resolves. */
function fetchChain(result: { data: unknown; error: { message: string } | null }) {
  const c: any = {
    eq: () => c,
    maybeSingle: () => Promise.resolve(result),
  };
  return c;
}

beforeEach(() => {
  requireRoleMock.mockReset();
  fromMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
});

describe("POST /api/admin/events/[id]/checkin", () => {
  it("rejects a body without checked_in", async () => {
    const res = await POST(req({ student_id: SID }), ctxFor("e1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("check-in stamps checked_in_at only when NULL — never source/rsvped_at", async () => {
    let updatePayload: Record<string, unknown> | null = null;
    const filters: Array<[string, ...unknown[]]> = [];
    const insertSpy = vi.fn();
    fromMock.mockImplementation((table: string) =>
      table === "event_attendance"
        ? {
            update: (p: Record<string, unknown>) => {
              updatePayload = p;
              return chain({ data: [{ student_id: SID }], error: null }, filters);
            },
            insert: insertSpy,
          }
        : {},
    );
    const res = await POST(req({ student_id: SID, checked_in: true }), ctxFor("e1"));
    expect(res.status).toBe(200);
    expect(Object.keys(updatePayload!)).toEqual(["checked_in_at"]);
    expect(typeof updatePayload!.checked_in_at).toBe("string");
    // The NULL guard is what keeps the original timestamp on a re-check-in.
    expect(filters).toEqual([
      ["eq", "student_id", SID],
      ["eq", "event_id", "e1"],
      ["is", "checked_in_at", null],
    ]);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("re-check-in on an already-checked-in row is a no-op (original timestamp kept, no insert)", async () => {
    const insertSpy = vi.fn();
    fromMock.mockImplementation((table: string) =>
      table === "event_attendance"
        ? {
            // checked_in_at already set → the NULL-guarded update matches 0 rows…
            update: () => chain({ data: [], error: null }),
            // …but the row exists, so the route must NOT insert a duplicate.
            select: () => fetchChain({ data: { student_id: SID }, error: null }),
            insert: insertSpy,
          }
        : {},
    );
    const res = await POST(req({ student_id: SID, checked_in: true }), ctxFor("e1"));
    expect(res.status).toBe(200);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("check-in with no existing row inserts a walk-in (source=checkin, rsvped_at=null)", async () => {
    let inserted: Record<string, unknown> | null = null;
    fromMock.mockImplementation((table: string) =>
      table === "event_attendance"
        ? {
            update: () => chain({ data: [], error: null }),
            select: () => fetchChain({ data: null, error: null }),
            insert: (row: Record<string, unknown>) => {
              inserted = row;
              return Promise.resolve({ error: null });
            },
          }
        : {},
    );
    const res = await POST(req({ student_id: SID, checked_in: true }), ctxFor("e1"));
    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({
      student_id: SID,
      event_id: "e1",
      source: "checkin",
      rsvped_at: null,
    });
    expect(typeof inserted!.checked_in_at).toBe("string");
  });

  it("undo always clears checked_in_at only — never deletes, never writes source=rsvp", async () => {
    let updatePayload: Record<string, unknown> | null = null;
    const filters: Array<[string, ...unknown[]]> = [];
    const deleteSpy = vi.fn();
    fromMock.mockImplementation((table: string) =>
      table === "event_attendance"
        ? {
            // Post-backfill, legacy source='checkin' rows are indistinguishable
            // from fresh walk-ins — deleting would destroy audit history.
            delete: deleteSpy,
            update: (p: Record<string, unknown>) => {
              updatePayload = p;
              return chain({ data: null, error: null }, filters);
            },
          }
        : {},
    );
    const res = await POST(req({ student_id: SID, checked_in: false }), ctxFor("e1"));
    expect(res.status).toBe(200);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(updatePayload).toEqual({ checked_in_at: null });
    expect(updatePayload).not.toHaveProperty("source");
    expect(updatePayload).not.toHaveProperty("rsvped_at");
    expect(filters).toEqual([
      ["eq", "student_id", SID],
      ["eq", "event_id", "e1"],
    ]);
  });

  it("resolves a member_id walk-in then checks in", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "students") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "sid-9" }, error: null }) }),
          }),
        };
      }
      return {
        update: () => chain({ data: [], error: null }),
        select: () => fetchChain({ data: null, error: null }),
        insert: () => Promise.resolve({ error: null }),
      };
    });
    const res = await POST(req({ member_id: "BIA-000009", checked_in: true }), ctxFor("e1"));
    expect(res.status).toBe(200);
    expect((await res.json()).student_id).toBe("sid-9");
  });

  it("404s when the member_id is not found", async () => {
    fromMock.mockImplementation((table: string) =>
      table === "students"
        ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
        : {},
    );
    const res = await POST(req({ member_id: "NOPE", checked_in: true }), ctxFor("e1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("student_not_found");
  });
});
