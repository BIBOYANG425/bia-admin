import { describe, expect, it } from "vitest";
import {
  COMMENT_MAX_LEN,
  COMMENT_MIN_LEN,
  COMMENT_STATUS_VALUES,
  isPublicComment,
  toPublicComment,
  type ArticleComment,
} from "./index";

const fullRow: ArticleComment = {
  id: "c1",
  article_id: "a1",
  author_name: "Reader",
  author_member_id: "m-42",
  body: "nice post",
  status: "visible",
  created_at: "2026-06-26T00:00:00Z",
  moderated_at: null,
  moderated_by: null,
};

describe("isPublicComment", () => {
  it("is true only for visible comments", () => {
    expect(isPublicComment({ status: "visible" })).toBe(true);
    expect(isPublicComment({ status: "hidden" })).toBe(false);
    expect(isPublicComment({ status: "deleted" })).toBe(false);
  });
});

describe("toPublicComment", () => {
  it("keeps the public fields verbatim", () => {
    expect(toPublicComment(fullRow)).toEqual({
      id: "c1",
      article_id: "a1",
      author_name: "Reader",
      body: "nice post",
      created_at: "2026-06-26T00:00:00Z",
    });
  });
  it("strips every moderation/internal field", () => {
    const pub = toPublicComment(fullRow) as unknown as Record<string, unknown>;
    expect("status" in pub).toBe(false);
    expect("moderated_at" in pub).toBe(false);
    expect("moderated_by" in pub).toBe(false);
    expect("author_member_id" in pub).toBe(false);
  });
});

describe("comment constants", () => {
  it("status values match the DB enum", () => {
    expect(COMMENT_STATUS_VALUES).toEqual(["visible", "hidden", "deleted"]);
  });
  it("body length bounds match the DB CHECK", () => {
    expect(COMMENT_MIN_LEN).toBe(1);
    expect(COMMENT_MAX_LEN).toBe(2000);
  });
});
