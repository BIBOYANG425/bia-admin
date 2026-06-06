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

  it("checks in by student_id (upsert source=checkin)", async () => {
    let captured: any = null;
    fromMock.mockImplementation((table: string) =>
      table === "event_attendance"
        ? {
            upsert: (row: unknown, opts: unknown) => {
              captured = { row, opts };
              return Promise.resolve({ error: null });
            },
          }
        : {},
    );
    const res = await POST(req({ student_id: SID, checked_in: true }), ctxFor("e1"));
    expect(res.status).toBe(200);
    expect(captured.row).toMatchObject({ student_id: SID, event_id: "e1", source: "checkin" });
    expect(captured.opts).toMatchObject({ onConflict: "student_id,event_id" });
  });

  it("undo (checked_in:false) writes source=rsvp", async () => {
    let captured: any = null;
    fromMock.mockImplementation(() => ({
      upsert: (row: unknown) => {
        captured = row;
        return Promise.resolve({ error: null });
      },
    }));
    const res = await POST(req({ student_id: SID, checked_in: false }), ctxFor("e1"));
    expect(res.status).toBe(200);
    expect(captured).toMatchObject({ source: "rsvp" });
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
      return { upsert: () => Promise.resolve({ error: null }) };
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
