// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDraftMap } from "../use-draft-map";

type Draft = { status?: string; note?: string | null };

describe("useDraftMap", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useDraftMap<Draft>());
    expect(result.current.drafts).toEqual({});
    expect(result.current.get("a")).toBeUndefined();
  });

  it("update() creates a draft then shallow-merges patches", () => {
    const { result } = renderHook(() => useDraftMap<Draft>());

    act(() => result.current.update("a", { status: "x" }));
    expect(result.current.get("a")).toEqual({ status: "x" });

    act(() => result.current.update("a", { note: "n" }));
    expect(result.current.get("a")).toEqual({ status: "x", note: "n" });
    expect(result.current.drafts).toEqual({ a: { status: "x", note: "n" } });
  });

  it("keeps drafts for different ids independent", () => {
    const { result } = renderHook(() => useDraftMap<Draft>());
    act(() => {
      result.current.update("a", { status: "1" });
      result.current.update("b", { status: "2" });
    });
    expect(result.current.get("a")).toEqual({ status: "1" });
    expect(result.current.get("b")).toEqual({ status: "2" });
  });

  it("clear() removes only the targeted draft", () => {
    const { result } = renderHook(() => useDraftMap<Draft>());
    act(() => {
      result.current.update("a", { status: "1" });
      result.current.update("b", { status: "2" });
    });

    act(() => result.current.clear("a"));
    expect(result.current.get("a")).toBeUndefined();
    expect(result.current.get("b")).toEqual({ status: "2" });
  });
});
