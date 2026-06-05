"use client";

// Admin parcel detail — edit status / weight / dims / notes; bump status.
// All writes go through PATCH /api/admin/shipping/parcels/[id], which uses the
// admin_patch_parcel RPC so the event log tags actor_role='admin'. Ported from
// bia-roommate (Phase-3 slice 3b-ii); weight/dims now sent as numbers (the
// source sent strings, which mismatched the zod schema).

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ParcelStatusPill } from "@/components/shipping/ParcelStatusPill";
import { StatusProgress } from "@/components/shipping/StatusProgress";
import {
  PARCEL_BRANCH_STATUSES,
  PARCEL_STATUS_META,
  PARCEL_STATUS_VALUES,
  PARCEL_STEPS,
  SHIPPING_METHOD_META,
  nextParcelStatus,
  type Parcel,
  type ParcelEvent,
  type ParcelStatus,
  type Shipment,
} from "@biboyang425/bia-shared/shipping";

interface DetailResponse {
  parcel: Parcel;
  events: ParcelEvent[];
  shipment: Shipment | null;
  photoUrls: string[];
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function AdminParcelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [events, setEvents] = useState<ParcelEvent[]>([]);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Draft values
  const [draftStatus, setDraftStatus] = useState<ParcelStatus | "">("");
  const [draftWeight, setDraftWeight] = useState("");
  const [draftL, setDraftL] = useState("");
  const [draftW, setDraftW] = useState("");
  const [draftH, setDraftH] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadParcel = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/shipping/parcels/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(res.status === 404 ? "包裹不存在" : "加载失败");
        return;
      }
      const data = (await res.json()) as DetailResponse;
      setParcel(data.parcel);
      setEvents(data.events);
      setShipment(data.shipment);
      setPhotoUrls(data.photoUrls ?? []);
      setDraftStatus(data.parcel.status);
      setDraftWeight(
        data.parcel.weight_grams !== null
          ? String(data.parcel.weight_grams)
          : "",
      );
      setDraftL(
        data.parcel.dim_cm_l !== null ? String(data.parcel.dim_cm_l) : "",
      );
      setDraftW(
        data.parcel.dim_cm_w !== null ? String(data.parcel.dim_cm_w) : "",
      );
      setDraftH(
        data.parcel.dim_cm_h !== null ? String(data.parcel.dim_cm_h) : "",
      );
      setDraftNotes(data.parcel.notes ?? "");
      setError(null);
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadParcel();
  }, [loadParcel]);

  const handleSave = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/shipping/parcels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? "保存失败");
        return;
      }
      setToast("已保存");
      setTimeout(() => setToast(null), 1500);
      await loadParcel();
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    if (!parcel) return;
    const patch: Record<string, unknown> = {};
    if (draftStatus && draftStatus !== parcel.status) patch.status = draftStatus;

    const weight = numOrNull(draftWeight);
    if (weight !== (parcel.weight_grams ?? null)) patch.weight_grams = weight;
    const l = numOrNull(draftL);
    if (l !== (parcel.dim_cm_l ?? null)) patch.dim_cm_l = l;
    const w = numOrNull(draftW);
    if (w !== (parcel.dim_cm_w ?? null)) patch.dim_cm_w = w;
    const h = numOrNull(draftH);
    if (h !== (parcel.dim_cm_h ?? null)) patch.dim_cm_h = h;
    if (draftNotes !== (parcel.notes ?? "")) patch.notes = draftNotes;

    // Flipping to received_cn with no received_at yet → stamp now.
    if (draftStatus === "received_cn" && !parcel.received_at) {
      patch.received_at = new Date().toISOString();
    }

    if (Object.keys(patch).length === 0) {
      setToast("没有改动");
      setTimeout(() => setToast(null), 1200);
      return;
    }
    await handleSave(patch);
  };

  const handleBumpNext = async () => {
    if (!parcel) return;
    const next = nextParcelStatus(parcel.status);
    if (!next) return;
    const patch: Record<string, unknown> = { status: next };
    if (next === "received_cn" && !parcel.received_at) {
      patch.received_at = new Date().toISOString();
    }
    await handleSave(patch);
  };

  if (loading) {
    return <p className="p-8 text-sm text-muted-foreground">加载中…</p>;
  }
  if (error || !parcel) {
    return <p className="p-8 text-sm text-rose-600">{error ?? "未找到"}</p>;
  }

  const next = nextParcelStatus(parcel.status);
  const steps = PARCEL_STEPS.map((k) => ({ key: k, label: PARCEL_STATUS_META[k].label }));
  const branches = PARCEL_BRANCH_STATUSES.map((k) => ({
    key: k,
    label: PARCEL_STATUS_META[k].label,
  }));

  return (
    <div className="space-y-6 p-8">
      {toast && (
        <div className="fixed right-4 top-20 z-50 rounded-md border bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/shipping/parcels"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← 包裹列表
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {parcel.description}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">{parcel.member_id}</span>
            {parcel.shipping_method && (
              <span>
                · {SHIPPING_METHOD_META[parcel.shipping_method].icon}{" "}
                {SHIPPING_METHOD_META[parcel.shipping_method].label}
              </span>
            )}
          </div>
        </div>
        <ParcelStatusPill status={parcel.status} />
      </div>

      <StatusProgress steps={steps} current={parcel.status} branches={branches} />

      {/* Editor */}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">编辑</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="status">状态</Label>
              <select
                id="status"
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value as ParcelStatus)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {PARCEL_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {PARCEL_STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="weight">重量 (克)</Label>
              <Input
                id="weight"
                type="number"
                value={draftWeight}
                onChange={(e) => setDraftWeight(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dimL">长 (cm)</Label>
              <Input
                id="dimL"
                type="number"
                step="0.1"
                value={draftL}
                onChange={(e) => setDraftL(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dimW">宽 (cm)</Label>
              <Input
                id="dimW"
                type="number"
                step="0.1"
                value={draftW}
                onChange={(e) => setDraftW(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dimH">高 (cm)</Label>
              <Input
                id="dimH"
                type="number"
                step="0.1"
                value={draftH}
                onChange={(e) => setDraftH(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="notes">管理员备注</Label>
              <textarea
                id="notes"
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                rows={2}
                placeholder="仓库备注 / 尺寸异常 / 处理记录"
                className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSaveAll} disabled={saving}>
              {saving ? "保存中…" : "保存所有修改"}
            </Button>
            {next && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleBumpNext}
                disabled={saving}
              >
                → 推进到「{PARCEL_STATUS_META[next].label}」
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Shipment */}
      {shipment && (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base">所属批次</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-sm">
            <Link
              href={`/admin/shipping/shipments/${shipment.id}`}
              className="font-medium hover:underline"
            >
              {shipment.name}
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              [{shipment.status}]
            </span>
          </CardContent>
        </Card>
      )}

      {/* Photos */}
      {photoUrls.length > 0 && (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base">照片</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {photoUrls.map((url, idx) => (
                <Image
                  key={idx}
                  src={url}
                  alt={`Photo ${idx + 1}`}
                  width={300}
                  height={200}
                  unoptimized
                  className="h-28 w-full rounded-md border object-cover"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">时间线</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无事件</p>
          ) : (
            <ol className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id} className="flex gap-3 text-sm">
                  <span className="whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground">
                    {fmtTime(ev.created_at)}
                  </span>
                  <div className="flex-1">
                    <span>
                      {ev.from_status
                        ? `${PARCEL_STATUS_META[ev.from_status].label} → ${PARCEL_STATUS_META[ev.to_status].label}`
                        : PARCEL_STATUS_META[ev.to_status].label}
                    </span>
                    {ev.actor_role && (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        [{ev.actor_role}]
                      </span>
                    )}
                    {ev.note && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ev.note}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
