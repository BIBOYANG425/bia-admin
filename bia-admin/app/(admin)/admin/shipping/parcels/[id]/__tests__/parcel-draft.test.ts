import { describe, expect, it } from "vitest";
import type { Parcel } from "@biboyang425/bia-shared/shipping";
import {
  diffParcelEditDraft,
  draftFromParcel,
  numOrNull,
} from "../parcel-draft";

// Minimal parcel fixture — the diff only reads the editable fields.
function makeParcel(over: Partial<Parcel> = {}): Parcel {
  return {
    id: "p1",
    member_id: "M1",
    status: "expected",
    description: "box",
    weight_grams: null,
    dim_cm_l: null,
    dim_cm_w: null,
    dim_cm_h: null,
    notes: null,
    received_at: null,
    ...over,
  } as Parcel;
}

describe("numOrNull", () => {
  it("blank / whitespace -> null, finite -> number, junk -> null", () => {
    expect(numOrNull("")).toBeNull();
    expect(numOrNull("   ")).toBeNull();
    expect(numOrNull(" 500 ")).toBe(500);
    expect(numOrNull("abc")).toBeNull();
  });
});

describe("draftFromParcel", () => {
  it("maps nulls to '' and numbers to their string form", () => {
    const p = makeParcel({ status: "received_cn", weight_grams: 800, notes: "hi" });
    expect(draftFromParcel(p)).toEqual({
      status: "received_cn",
      weight_grams: "800",
      dim_cm_l: "",
      dim_cm_w: "",
      dim_cm_h: "",
      notes: "hi",
    });
  });
});

describe("diffParcelEditDraft", () => {
  it("emits nothing when unchanged", () => {
    const p = makeParcel({ weight_grams: 500, dim_cm_l: 10, notes: "n" });
    expect(diffParcelEditDraft(draftFromParcel(p), p)).toEqual({});
  });

  it("status change emitted; empty status skipped", () => {
    const p = makeParcel({ status: "expected" });
    expect(
      diffParcelEditDraft({ ...draftFromParcel(p), status: "received_cn" }, p),
    ).toEqual({ status: "received_cn" });
    expect(diffParcelEditDraft({ ...draftFromParcel(p), status: "" }, p)).toEqual(
      {},
    );
  });

  it("number fields use transformed compare: '0500' == stored 500 (no change)", () => {
    const p = makeParcel({ weight_grams: 500 });
    expect(
      diffParcelEditDraft({ ...draftFromParcel(p), weight_grams: "0500" }, p),
    ).toEqual({});
  });

  it("clearing a number emits null; setting emits Number", () => {
    const cleared = makeParcel({ weight_grams: 500 });
    expect(
      diffParcelEditDraft({ ...draftFromParcel(cleared), weight_grams: "" }, cleared),
    ).toEqual({ weight_grams: null });

    const empty = makeParcel({ dim_cm_l: null });
    expect(
      diffParcelEditDraft({ ...draftFromParcel(empty), dim_cm_l: "12.5" }, empty),
    ).toEqual({ dim_cm_l: 12.5 });
  });

  it("clearing notes sends '' (not null)", () => {
    const p = makeParcel({ notes: "old" });
    expect(diffParcelEditDraft({ ...draftFromParcel(p), notes: "" }, p)).toEqual({
      notes: "",
    });
  });

  it("emits changed keys in the original handleSaveAll order", () => {
    const p = makeParcel({ status: "expected", weight_grams: 100, notes: "old" });
    const draft = {
      ...draftFromParcel(p),
      status: "received_cn" as const,
      weight_grams: "200",
      dim_cm_w: "5",
      notes: "new",
    };
    expect(Object.keys(diffParcelEditDraft(draft, p))).toEqual([
      "status",
      "weight_grams",
      "dim_cm_w",
      "notes",
    ]);
  });
});
