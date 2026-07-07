"use client";

// Shipment editor card (批次信息). Owns a single `draft` object (one field per
// editable column) seeded from the loaded shipment, re-seeded whenever the
// shipment prop changes (matches the old behaviour of re-seeding every draft on
// each load()). "保存所有修改" runs the generic diff and PATCHes only changed
// fields via the parent's `onSave`; an empty diff toasts "没有改动" exactly as
// before. Save-button gating uses the parent's shared `saving`.
//
// Header last reviewed: 2026-07-07

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SHIPMENT_STATUS_LABELS } from "@/lib/shipping/labels";
import {
  SHIPMENT_STATUS_VALUES,
  type Shipment,
  type ShipmentStatus,
} from "@biboyang425/bia-shared/shipping";
import {
  diffShipmentDraft,
  draftFromShipment,
  type ShipmentDraft,
} from "./shipment-draft";

export function ShipmentEditor({
  shipment,
  canWrite,
  saving,
  onSave,
}: {
  shipment: Shipment;
  canWrite: boolean;
  saving: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<ShipmentDraft>(() =>
    draftFromShipment(shipment),
  );

  // Re-seed on every shipment change (each load() hands a fresh object), so a
  // successful save / attach / advance resets the editor to the saved values.
  useEffect(() => {
    setDraft(draftFromShipment(shipment));
  }, [shipment]);

  const set = <K extends keyof ShipmentDraft>(key: K, value: ShipmentDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    const patch = diffShipmentDraft(draft, shipment);
    if (Object.keys(patch).length === 0) {
      toast("没有改动");
      return;
    }
    await onSave(patch);
  };

  return (
    <Card>
      <CardHeader className="p-4">
        <CardTitle className="text-base">批次信息</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="name">名称</Label>
            <Input
              id="name"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">状态</Label>
            <select
              id="status"
              value={draft.status}
              onChange={(e) => set("status", e.target.value as ShipmentStatus)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {SHIPMENT_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {SHIPMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="carrier">承运</Label>
            <Input
              id="carrier"
              value={draft.carrier}
              onChange={(e) => set("carrier", e.target.value)}
              placeholder="如 DHL"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tracking">国际运单号</Label>
            <Input
              id="tracking"
              value={draft.international_tracking}
              onChange={(e) => set("international_tracking", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="departed">国内发出时间</Label>
            <Input
              id="departed"
              type="datetime-local"
              value={draft.departed_cn_at}
              onChange={(e) => set("departed_cn_at", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="arrived">到美时间</Label>
            <Input
              id="arrived"
              type="datetime-local"
              value={draft.arrived_us_at}
              onChange={(e) => set("arrived_us_at", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="location">取件地点</Label>
            <Input
              id="location"
              value={draft.pickup_location}
              onChange={(e) => set("pickup_location", e.target.value)}
              placeholder="如 THH 301, USC"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="price">单价/kg (分)</Label>
            <Input
              id="price"
              type="number"
              value={draft.price_per_kg_cents}
              onChange={(e) => set("price_per_kg_cents", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="start">取件开始</Label>
            <Input
              id="start"
              type="datetime-local"
              value={draft.pickup_starts_at}
              onChange={(e) => set("pickup_starts_at", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="end">取件结束</Label>
            <Input
              id="end"
              type="datetime-local"
              value={draft.pickup_ends_at}
              onChange={(e) => set("pickup_ends_at", e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="notes">备注</Label>
            <textarea
              id="notes"
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
        </div>
        {canWrite ? (
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存所有修改"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">只读：无法修改</p>
        )}
      </CardContent>
    </Card>
  );
}
