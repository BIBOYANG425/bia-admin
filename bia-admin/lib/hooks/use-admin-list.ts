import { useCallback, useEffect, useRef, useState } from "react";

// Shared read-list hook for the admin list pages. Replaces the hand-rolled
// fetch-on-mount-with-`let cancelled`-flag effects (and their re-inlined
// load()/reload() twins) that every shipping list page used to carry.
//
// Race guard: each call bumps a monotonic sequence ref; a response is applied
// only if its sequence is still the latest, so a slow earlier request can never
// clobber the result of a newer one (e.g. fast filter-switching). Refetches
// whenever `url` changes; `reload()` re-runs the current url on demand (used by
// pages after their own PATCH/POST save logic).
//
// `loading` is derived (`loadedUrl !== url`): it is true for the initial load
// and whenever `url` changes, and clears once the latest request settles. A
// manual `reload()` keeps the same url, so it refreshes silently with no
// `loading` flash — matching the in-place updates the pages did after a save.

export interface AdminList<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAdminList<T>(url: string): AdminList<T> {
  const [data, setData] = useState<T | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (seq !== seqRef.current) return; // superseded by a newer request
      if (!res.ok) {
        setError(`请求失败（${res.status}）`);
        return;
      }
      const json = (await res.json()) as T;
      if (seq !== seqRef.current) return; // superseded while parsing
      setError(null);
      setData(json);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof Error ? e.message : "网络错误");
    } finally {
      if (seq === seqRef.current) setLoadedUrl(url);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading: loadedUrl !== url, error, reload: load };
}
