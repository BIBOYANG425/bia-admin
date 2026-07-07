"use client";

// Bulk-advance card (批量推进包裹状态). One action advances the whole batch of
// parcels along the happy path to a chosen status; branch/terminal targets
// (lost/returned/disputed) require an explicit confirm. Fully self-contained:
// owns its own `bulkStatus` + `bulkBusy` (independent of the page's shared
// `saving`, exactly as the original — advance never touched `saving`). POSTs
// /advance-parcels and calls `onDone` (reload) on success.
//
// Header last reviewed: 2026-07-07

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errText } from "@/lib/shipping/labels";
import {
  PARCEL_BRANCH_STATUSES,
  PARCEL_STATUS_META,
  PARCEL_STEPS,
  type Parcel,
  type ParcelStatus,
} from "@biboyang425/bia-shared/shipping";

// Forward happy-path bulk-advance targets: every step AFTER 'expected'
// (received_cn → picked_up). A parcel is never bulk-created/regressed to
// 'expected', so it isn't an advance target. Branch/terminal states
// (lost/returned/disputed) are kept separate and require an explicit confirm
// since they mass-mutate the whole batch off the happy path.
const FORWARD_ADVANCE_TARGETS: ParcelStatus[] = PARCEL_STEPS.filter(
  (s) => s !== "expected",
);
const BRANCH_TARGET_SET = new Set<ParcelStatus>(PARCEL_BRANCH_STATUSES);

export function BulkAdvancePanel({
  shipmentId,
  parcels,
  onDone,
}: {
  shipmentId: string;
  parcels: Parcel[];
  onDone: () => Promise<void> | void;
}) {
  const [bulkStatus, setBulkStatus] = useState<ParcelStatus | "">("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const advanceParcels = async () => {
    if (!bulkStatus || parcels.length === 0) return;
    // Branch/terminal targets (lost/returned/disputed) mass-mutate the entire
    // batch off the happy path — make the officer confirm explicitly.
    if (BRANCH_TARGET_SET.has(bulkStatus)) {
      const label = PARCEL_STATUS_META[bulkStatus].label;
      if (
        !window.confirm(
          `确认把本批 ${parcels.length} 个包裹全部标记为「${label}」？这是分支/终态，会影响整批，且无法批量回退。`,
        )
      ) {
        return;
      }
    }
    setBulkBusy(true);
    try {
      const res = await fetch(
        `/api/admin/shipping/shipments/${shipmentId}/advance-parcels`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: bulkStatus }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errText(err, "批量推进失败"));
        return;
      }
      const data = (await res.json()) as { updated: number; skipped: number };
      toast.success(`已推进 ${data.updated} 个包裹（跳过 ${data.skipped}）`);
      setBulkStatus("");
      await onDone();
    } catch {
      toast.error("批量推进失败");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="p-4">
        <CardTitle className="text-base">批量推进包裹状态</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        <p className="text-xs text-muted-foreground">
          一键把本批 {parcels.length} 个包裹沿正常流程推进到所选状态（只前进，
          跳过已在该状态/已超前/分支状态的包裹）。分支/终态（丢失/退回/待核实）会影响整批，
          需二次确认。审计照常记录；每个推进会给学生入队一条状态通知（通知功能开启后下发）。
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as ParcelStatus | "")}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="">选目标状态…</option>
            <optgroup label="正常推进">
              {FORWARD_ADVANCE_TARGETS.map((s) => (
                <option key={s} value={s}>
                  {PARCEL_STATUS_META[s].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="分支 / 终态（需确认）">
              {PARCEL_BRANCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PARCEL_STATUS_META[s].label}
                </option>
              ))}
            </optgroup>
          </select>
          <Button
            type="button"
            className="shrink-0"
            onClick={advanceParcels}
            disabled={!bulkStatus || bulkBusy}
          >
            {bulkBusy ? "推进中…" : "批量推进"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
