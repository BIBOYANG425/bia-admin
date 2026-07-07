import { useCallback, useState } from "react";

// Shared inline-edit draft store for the admin list pages. Holds a
// per-row-id map of pending edits; pages read `get(id)`/`drafts`, stage edits
// with `update(id, patch)` (shallow-merged onto any existing draft), and drop a
// row's draft with `clear(id)` once their own PATCH save succeeds.
//
// Save/PATCH logic stays per page — this only owns the draft bookkeeping that
// every editable shipping list page used to hand-roll.

export interface DraftMap<Draft extends object> {
  drafts: Record<string, Draft>;
  get: (id: string) => Draft | undefined;
  update: (id: string, patch: Partial<Draft>) => void;
  clear: (id: string) => void;
}

export function useDraftMap<Draft extends object>(): DraftMap<Draft> {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const update = useCallback((id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), ...patch } as Draft,
    }));
  }, []);

  const clear = useCallback((id: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const get = useCallback((id: string) => drafts[id], [drafts]);

  return { drafts, get, update, clear };
}
