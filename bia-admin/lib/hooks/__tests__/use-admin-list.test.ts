// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAdminList } from "../use-admin-list";

type Res = { ok: boolean; status: number; json: () => Promise<unknown> };
const ok = (body: unknown): Res => ({
  ok: true,
  status: 200,
  json: async () => body,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useAdminList", () => {
  it("fetches on mount with cache:no-store and exposes the parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([1, 2, 3]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminList<number[]>("/api/x"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual([1, 2, 3]);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/x", { cache: "no-store" });
  });

  it("refetches when the url changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(["a"]))
      .mockResolvedValueOnce(ok(["b"]));
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ url }) => useAdminList<string[]>(url),
      { initialProps: { url: "/api/a" } },
    );

    await waitFor(() => expect(result.current.data).toEqual(["a"]));
    rerender({ url: "/api/b" });
    await waitFor(() => expect(result.current.data).toEqual(["b"]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reload() refetches the current url on demand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(["first"]))
      .mockResolvedValueOnce(ok(["second"]));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminList<string[]>("/api/x"));
    await waitFor(() => expect(result.current.data).toEqual(["first"]));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toEqual(["second"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("race guard: a slow first response must not clobber a newer one", async () => {
    let resolveSlow!: (r: Res) => void;
    const slow = new Promise<Res>((res) => {
      resolveSlow = res;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(slow) // url a — resolves last
      .mockReturnValueOnce(Promise.resolve(ok(["new"]))); // url b — resolves first
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ url }) => useAdminList<string[]>(url),
      { initialProps: { url: "/api/a" } },
    );

    // Switch url before the first request resolves.
    rerender({ url: "/api/b" });
    await waitFor(() => expect(result.current.data).toEqual(["new"]));

    // Now let the stale first request finish — it must be ignored.
    await act(async () => {
      resolveSlow(ok(["stale"]));
      await slow;
    });

    expect(result.current.data).toEqual(["new"]);
  });

  it("sets error and leaves data null on a non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminList("/api/x"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toBeNull();
  });
});
