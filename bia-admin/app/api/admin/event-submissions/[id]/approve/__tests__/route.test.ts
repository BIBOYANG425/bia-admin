import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRoleMock, fromMock, capMock, auditMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  fromMock: vi.fn(),
  capMock: vi.fn(),
  auditMock: vi.fn(),
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

vi.mock("@/lib/marketplace/cap-enforcement", () => ({
  MARKETPLACE_WEEKLY_CAP: 20,
  countApprovedSubmissionsThisWeek: capMock,
}));

vi.mock("@/lib/admin/audit-log", () => ({ writeAudit: auditMock }));

import { POST } from "../route";

const editor = {
  user: { id: "e1", email: "editor@uscbia.com" },
  role: "editor" as const,
  adminUser: { id: "e1", email: "editor@uscbia.com" },
};
const SUB_ID = "11111111-1111-1111-1111-111111111111";

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req() {
  return new Request("http://localhost/api/admin/event-submissions/x/approve", {
    method: "POST",
  });
}

// Builds a fromMock where the submission lookup returns `submission`, the events
// insert returns a new id, and the submission update succeeds.
function wireHappyPath(submission: Record<string, unknown>) {
  fromMock.mockImplementation((table: string) => {
    if (table === "event_submissions") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: submission, error: null }) }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === "events") {
      return {
        insert: () => ({
          select: () => ({ single: () => Promise.resolve({ data: { id: "ev-9" }, error: null }) }),
        }),
      };
    }
    return {};
  });
}

beforeEach(() => {
  requireRoleMock.mockReset();
  fromMock.mockReset();
  capMock.mockReset();
  auditMock.mockReset();
  requireRoleMock.mockResolvedValue(editor);
  capMock.mockResolvedValue(0);
});

describe("POST /api/admin/event-submissions/[id]/approve", () => {
  it("approves a pending submission: inserts an event and links it back", async () => {
    let insertedEvent: any = null;
    let submissionUpdate: any = null;
    fromMock.mockImplementation((table: string) => {
      if (table === "event_submissions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: SUB_ID,
                    status: "pending",
                    title: "Boba Night",
                    description: "come thru",
                    date: null,
                    location: "TCC",
                    category: "social",
                  },
                  error: null,
                }),
            }),
          }),
          update: (row: any) => {
            submissionUpdate = row;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === "events") {
        return {
          insert: (row: any) => {
            insertedEvent = row;
            return {
              select: () => ({ single: () => Promise.resolve({ data: { id: "ev-9" }, error: null }) }),
            };
          },
        };
      }
      return {};
    });

    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, event_id: "ev-9" });
    expect(insertedEvent).toMatchObject({
      title: "Boba Night",
      location: "TCC",
      category: "social",
      source: "community",
      status: "active",
    });
    expect(submissionUpdate).toMatchObject({
      status: "approved",
      approved_event_id: "ev-9",
      decided_by: "e1",
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event_submission.approve",
        entity_type: "event_submission",
        entity_id: SUB_ID,
      }),
    );
  });

  it("404s when the submission does not exist", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("409s when the submission is not pending", async () => {
    wireHappyPath({ id: SUB_ID, status: "approved", title: "x" });
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invalid_transition");
  });

  it("429s when the weekly cap is reached", async () => {
    capMock.mockResolvedValue(20);
    wireHappyPath({ id: SUB_ID, status: "pending", title: "x" });
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("cap_reached");
  });

  it("403s a viewer (role gate)", async () => {
    requireRoleMock.mockRejectedValue(
      Object.assign(new Error("role_required: editor"), { status: 403, code: "role_required: editor" }),
    );
    const res = await POST(req(), ctxFor(SUB_ID));
    expect(res.status).toBe(403);
  });
});
