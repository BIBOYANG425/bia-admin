"use client";

// Attach picker card. Renders when the page's "+ 关联" toggle is open. Owns the
// selection Set + search filter over the unassigned received_cn pool. The POST
// itself lives in the page (`onAttach`) so it flips the page's shared `saving`
// and reloads; on success this panel clears its selection and calls `onClose`.
// The submit button's disabled gating (`selected.size === 0 || saving`) is
// unchanged.
//
// Header last reviewed: 2026-07-07

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  SHIPPING_METHOD_META,
  type Parcel,
} from "@biboyang425/bia-shared/shipping";

export function AttachPanel({
  unassigned,
  saving,
  onAttach,
  onClose,
}: {
  unassigned: Parcel[];
  saving: boolean;
  onAttach: (parcelIds: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attachSearch, setAttachSearch] = useState("");

  const toggleSelected = (pid: string) => {
    setSelected((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(pid)) nextSet.delete(pid);
      else nextSet.add(pid);
      return nextSet;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return;
    const ok = await onAttach(Array.from(selected));
    if (ok) {
      setSelected(new Set());
      onClose();
    }
  };

  const q = attachSearch.trim().toLowerCase();
  const filteredUnassigned = q
    ? unassigned.filter(
        (p) =>
          (p.member_id ?? "").toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          (p.tracking_cn ?? "").toLowerCase().includes(q),
      )
    : unassigned;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          选择待关联的 received_cn 包裹 · 附加后自动推进到 in_transit（会给学生入队一条通知）
        </p>
        {unassigned.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            没有已签收但未关联批次的包裹
          </p>
        ) : (
          <>
            <Input
              value={attachSearch}
              onChange={(e) => setAttachSearch(e.target.value)}
              placeholder="搜 Member ID / 描述 / 单号…"
              className="h-8"
            />
            {unassigned.length >= 200 && (
              <p className="text-xs text-amber-700">
                仅显示前 200 个待关联包裹 — 请用上面的搜索缩小范围。
              </p>
            )}
            <label className="flex cursor-pointer items-center gap-2 border-b px-2 py-1 text-xs font-medium hover:bg-muted">
              <input
                type="checkbox"
                checked={
                  selected.size === filteredUnassigned.length &&
                  filteredUnassigned.length > 0
                }
                onChange={(e) => {
                  if (e.target.checked)
                    setSelected(new Set(filteredUnassigned.map((p) => p.id)));
                  else setSelected(new Set());
                }}
              />
              全选（当前筛选） · 已选 {selected.size} /{" "}
              {filteredUnassigned.length}
            </label>
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {filteredUnassigned.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                    />
                    <span className="font-medium">{p.member_id}</span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {p.description}
                    </span>
                    {p.shipping_method && (
                      <span className="text-muted-foreground">
                        {SHIPPING_METHOD_META[p.shipping_method].icon}
                      </span>
                    )}
                    {p.weight_grams && (
                      <span className="text-muted-foreground">
                        {(p.weight_grams / 1000).toFixed(1)}kg
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              onClick={submit}
              disabled={selected.size === 0 || saving}
            >
              附加 {selected.size} 个包裹
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
