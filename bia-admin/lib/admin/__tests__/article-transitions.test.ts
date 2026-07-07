import { describe, expect, it } from "vitest";
import { TRANSITIONS } from "../article-transitions";

/**
 * Table test: asserts each TRANSITIONS entry's from-statuses, target status,
 * and audit action without invoking the runner or any DB/network calls.
 */
describe("TRANSITIONS config table", () => {
  it("each action declares correct fromStatuses, toStatus, and auditAction", () => {
    expect(TRANSITIONS.submit.fromStatuses).toEqual(["draft"]);
    expect(TRANSITIONS.submit.toStatus).toBe("in_review");
    expect(TRANSITIONS.submit.auditAction).toBe("article.submit");

    expect(TRANSITIONS.publish.fromStatuses).toEqual(["in_review", "unpublished"]);
    expect(TRANSITIONS.publish.toStatus).toBe("published");
    expect(TRANSITIONS.publish.auditAction).toBe("article.publish");

    expect(TRANSITIONS.reject.fromStatuses).toEqual(["in_review"]);
    expect(TRANSITIONS.reject.toStatus).toBe("draft");
    expect(TRANSITIONS.reject.auditAction).toBe("article.reject");

    expect(TRANSITIONS.unpublish.fromStatuses).toEqual(["published"]);
    expect(TRANSITIONS.unpublish.toStatus).toBe("unpublished");
    expect(TRANSITIONS.unpublish.auditAction).toBe("article.unpublish");
  });
});
