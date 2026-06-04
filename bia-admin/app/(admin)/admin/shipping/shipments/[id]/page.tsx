"use client";

// Admin shipment detail — edit fields, see attached parcels, run attach flow,
// visualize batch progress, advance status. Ported from bia-roommate
// (Phase-3 slice 4), restyled to shadcn.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusProgress } from "@/components/shipping/StatusProgress";
import { BatchProgress } from "@/components/shipping/BatchProgress";
import { ParcelStatusPill } from "@/components/shipping/ParcelStatusPill";
import {
  SHIPMENT_STATUS_VALUES,
  SHIPPING_METHOD_META,
  SHIPMENT_STEPS,
  nextShipmentStatus,
  type Parcel,
  type Shipment,
  type ShipmentStatus,
} from "@biboyang425/bia-shared/shipping";

const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  forming: "组建中",
  sealed: "已封箱",
  departed_cn: "国内发出",
  customs: "清关中",
  arrived_us: "到达美国",
  pickup_open: "可取件",
  pickup_closed: "已关闭",
  archived: "已归档",
};

function toLocalInput(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export default function AdminShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [unassigned, setUnassigned] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Draft fields
  const [draftName, setDraftName] = useState("");
  const [draftStatus, setDraftStatus] = useState<ShipmentStatus>("forming");
  const [draftCarrier, setDraftCarrier] = useState("");
  const [draftTracking, setDraftTracking] = useState("");
  const [draftDeparted, setDraftDeparted] = useState("");
  const [draftArrived, setDraftArrived] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  // Attach flow
  const [showAttach, setShowAttach] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const [res, unassignedRes] = await Promise.all([
      fetch(`/api/admin/shipping/shipments/${id}`, { cache: "no-store" }),
      fetch(
        `/api/admin/shipping/parcels?shipment_id=null&status=received_cn&limit=200`,
        { cache: "no-store" },
      ),
    ]);
    if (!res.ok) {
      setError(res.status === 404 ? "批次不存在" : "加载失败");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { shipment: Shipment; parcels: Parcel[] };
    setShipment(data.shipment);
    setParcels(data.parcels);
    setDraftName(data.shipment.name);
    setDraftStatus(data.shipment.status);
    setDraftCarrier(data.shipment.carrier ?? "");
    setDraftTracking(data.shipment.international_tracking ?? "");
    setDraftDeparted(toLocalInput(data.shipment.departed_cn_at));
    setDraftArrived(toLocalInput(data.shipment.arrived_us_at));
    setDraftLocation(data.shipment.pickup_location ?? "");
    setDraftStart(toLocalInput(data.shipment.pickup_starts_at));
    setDraftEnd(toLocalInput(data.shipment.pickup_ends_at));
    setDraftPrice(
      data.shipment.price_per_kg_cents !== null
        ? String(data.shipment.price_per_kg_cents)
        : "",
    );
    setDraftNotes(data.shipment.notes ?? "");

    if (unassignedRes.ok) {
      const u = (await unassignedRes.json()) as { parcels: Parcel[] };
      setUnassigned(u.parcels);
    }
    setError(null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchShipment = async (patch: Record<string, unknown>) => {
    setSaving(true);
    const res = await fetch(`/api/admin/shipping/shipments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setToast(err.error ?? "保存失败");
      setTimeout(() => setToast(null), 1800);
      return false;
    }
    setToast("已保存");
    setTimeout(() => setToast(null), 1500);
    await load();
    return true;
  };

  const saveAll = async () => {
    if (!shipment) return;
    const patch: Record<string, unknown> = {};
    if (draftName !== shipment.name) patch.name = draftName;
    if (draftStatus !== shipment.status) patch.status = draftStatus;
    if (draftCarrier !== (shipment.carrier ?? "")) patch.carrier = draftCarrier;
    if (draftTracking !== (shipment.international_tracking ?? ""))
      patch.international_tracking = draftTracking;
    if (fromLocalInput(draftDeparted) !== shipment.departed_cn_at)
      patch.departed_cn_at = fromLocalInput(draftDeparted);
    if (fromLocalInput(draftArrived) !== shipment.arrived_us_at)
      patch.arrived_us_at = fromLocalInput(draftArrived);
    if (draftLocation !== (shipment.pickup_location ?? ""))
      patch.pickup_location = draftLocation;
    if (fromLocalInput(draftStart) !== shipment.pickup_starts_at)
      patch.pickup_starts_at = fromLocalInput(draftStart);
    if (fromLocalInput(draftEnd) !== shipment.pickup_ends_at)
      patch.pickup_ends_at = fromLocalInput(draftEnd);
    const currentPrice =
      shipment.price_per_kg_cents !== null
        ? String(shipment.price_per_kg_cents)
        : "";
    if (draftPrice !== currentPrice) {
      patch.price_per_kg_cents = draftPrice === "" ? null : Number(draftPrice);
    }
    if (draftNotes !== (shipment.notes ?? "")) patch.notes = draftNotes;

    if (Object.keys(patch).length === 0) {
      setToast("没有改动");
      setTimeout(() => setToast(null), 1200);
      return;
    }
    await patchShipment(patch);
  };

  const bumpNext = async () => {
    if (!shipment) return;
    const next = nextShipmentStatus(shipment.status);
    if (!next) return;
    await patchShipment({ status: next });
  };

  const toggleSelected = (pid: string) => {
    setSelected((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(pid)) nextSet.delete(pid);
      else nextSet.add(pid);
      return nextSet;
    });
  };

  const attachSelected = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    const res = await fetch(`/api/admin/shipping/shipments/${id}/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parcel_ids: Array.from(selected) }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setToast(err.error ?? "附加失败");
      setTimeout(() => setToast(null), 1800);
      return;
    }
    const data = (await res.json()) as { updated: number };
    setToast(`已附加 ${data.updated} 个`);
    setTimeout(() => setToast(null), 1500);
    setSelected(new Set());
    setShowAttach(false);
    await load();
  };

  if (loading) {
    return <p className="p-8 text-sm text-muted-foreground">加载中…</p>;
  }
  if (error || !shipment) {
    return <p className="p-8 text-sm text-rose-600">{error ?? "未找到"}</p>;
  }

  const next = nextShipmentStatus(shipment.status);
  const steps = SHIPMENT_STEPS.map((k) => ({
    key: k,
    label: SHIPMENT_STATUS_LABELS[k],
  }));

  return (
    <div className="space-y-6 p-8">
      {toast && (
        <div className="fixed right-4 top-20 z-50 rounded-md border bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <Link
          href="/admin/shipping/shipments"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← 批次列表
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {shipment.name}
        </h1>
      </div>

      {/* Progress */}
      <div className="space-y-3">
        <StatusProgress steps={steps} current={shipment.status} />
        {next && (
          <Button
            type="button"
            variant="secondary"
            onClick={bumpNext}
            disabled={saving}
          >
            → 推进到「{SHIPMENT_STATUS_LABELS[next]}」
          </Button>
        )}
      </div>

      {/* Editor */}
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
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="status">状态</Label>
              <select
                id="status"
                value={draftStatus}
                onChange={(e) =>
                  setDraftStatus(e.target.value as ShipmentStatus)
                }
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
                value={draftCarrier}
                onChange={(e) => setDraftCarrier(e.target.value)}
                placeholder="如 DHL"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tracking">国际运单号</Label>
              <Input
                id="tracking"
                value={draftTracking}
                onChange={(e) => setDraftTracking(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="departed">国内发出时间</Label>
              <Input
                id="departed"
                type="datetime-local"
                value={draftDeparted}
                onChange={(e) => setDraftDeparted(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="arrived">到美时间</Label>
              <Input
                id="arrived"
                type="datetime-local"
                value={draftArrived}
                onChange={(e) => setDraftArrived(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="location">取件地点</Label>
              <Input
                id="location"
                value={draftLocation}
                onChange={(e) => setDraftLocation(e.target.value)}
                placeholder="如 THH 301, USC"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="price">单价/kg (分)</Label>
              <Input
                id="price"
                type="number"
                value={draftPrice}
                onChange={(e) => setDraftPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="start">取件开始</Label>
              <Input
                id="start"
                type="datetime-local"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end">取件结束</Label>
              <Input
                id="end"
                type="datetime-local"
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="notes">备注</Label>
              <textarea
                id="notes"
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </div>
          </div>
          <Button type="button" onClick={saveAll} disabled={saving}>
            {saving ? "保存中…" : "保存所有修改"}
          </Button>
        </CardContent>
      </Card>

      {/* Batch progress */}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">
            批次进度（{parcels.length} 个包裹）
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <BatchProgress parcels={parcels} />
        </CardContent>
      </Card>

      {/* Attached parcels + attach flow */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">已关联包裹</h2>
          <Button
            type="button"
            variant={showAttach ? "outline" : "secondary"}
            onClick={() => setShowAttach((v) => !v)}
          >
            {showAttach ? "取消" : `+ 关联（${unassigned.length} 待关联）`}
          </Button>
        </div>

        {showAttach && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-xs text-muted-foreground">
                选择待关联的 received_cn 包裹 · 附加后自动推进到 in_transit
              </p>
              {unassigned.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  没有已签收但未关联批次的包裹
                </p>
              ) : (
                <>
                  <ul className="max-h-80 space-y-1 overflow-y-auto">
                    {unassigned.map((p) => (
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
                    onClick={attachSelected}
                    disabled={selected.size === 0 || saving}
                  >
                    附加 {selected.size} 个包裹
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {parcels.length === 0 ? (
          <p className="text-xs text-muted-foreground">这个批次还没有包裹</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">Member</TableHead>
                  <TableHead className="px-4">Description</TableHead>
                  <TableHead className="w-32 px-4">Status</TableHead>
                  <TableHead className="w-24 px-4">重量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parcels.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="px-4 py-2">
                      <Link
                        href={`/admin/shipping/parcels/${p.id}`}
                        className="font-medium hover:underline"
                      >
                        {p.member_id}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate px-4 py-2">
                      {p.description}
                    </TableCell>
                    <TableCell className="px-4 py-2">
                      <ParcelStatusPill status={p.status} size="sm" />
                    </TableCell>
                    <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                      {p.weight_grams
                        ? `${(p.weight_grams / 1000).toFixed(1)} kg`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
