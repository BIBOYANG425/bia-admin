"use client";

// Admin shipment detail — composition + data loading only. Loads the shipment,
// its parcels and the unassigned received_cn pool, owns the shared `saving`
// flag and the write actions (patch / bump / attach / detach) that flip it, and
// composes the colocated feature components:
//   ShipmentEditor    — 批次信息 editor (one draft object + generic diff).
//   BulkAdvancePanel  — 批量推进 whole-batch advance.
//   AttachPanel       — attach picker (received_cn pool).
//   AttachedParcels   — attached-parcels table + per-row detach (SR-7).
// Ported from bia-roommate (Phase-3 slice 4), restyled to shadcn; decomposed in
// task-17 (was a ~749-line monolith with 11 parallel draft states).
//
// Header last reviewed: 2026-07-07

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusProgress } from "@/components/shipping/StatusProgress";
import { BatchProgress } from "@/components/shipping/BatchProgress";
import { useCanWrite } from "@/lib/auth/role-context";
import { SHIPMENT_STATUS_LABELS, errText } from "@/lib/shipping/labels";
import {
  SHIPMENT_STEPS,
  nextShipmentStatus,
  type Parcel,
  type Shipment,
} from "@biboyang425/bia-shared/shipping";
import { ShipmentEditor } from "./ShipmentEditor";
import { BulkAdvancePanel } from "./BulkAdvancePanel";
import { AttachPanel } from "./AttachPanel";
import { AttachedParcels } from "./AttachedParcels";

export default function AdminShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canWrite = useCanWrite();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [unassigned, setUnassigned] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAttach, setShowAttach] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, unassignedRes] = await Promise.all([
        fetch(`/api/admin/shipping/shipments/${id}`, { cache: "no-store" }),
        fetch(
          `/api/admin/shipping/parcels?shipment_id=null&status=received_cn&limit=200`,
          { cache: "no-store" },
        ),
      ]);
      if (!res.ok) {
        setError(res.status === 404 ? "批次不存在" : "加载失败");
        return;
      }
      const data = (await res.json()) as {
        shipment: Shipment;
        parcels: Parcel[];
      };
      setShipment(data.shipment);
      setParcels(data.parcels);

      if (unassignedRes.ok) {
        const u = (await unassignedRes.json()) as { parcels: Parcel[] };
        setUnassigned(u.parcels);
      }
      setError(null);
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchShipment = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/shipping/shipments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        toast.error(errText(err, "保存失败"));
        return false;
      }
      toast.success("已保存");
      await load();
      return true;
    } catch {
      toast.error("保存失败，请检查网络后重试");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const bumpNext = async () => {
    if (!shipment) return;
    const next = nextShipmentStatus(shipment.status);
    if (!next) return;
    await patchShipment({ status: next });
  };

  const attachSelected = async (parcelIds: string[]): Promise<boolean> => {
    if (parcelIds.length === 0) return false;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/shipping/shipments/${id}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel_ids: parcelIds }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errText(err, "附加失败"));
        return false;
      }
      const data = (await res.json()) as { updated: number; skipped?: number };
      toast.success(
        `已附加 ${data.updated} 个` +
          (data.skipped ? `（跳过 ${data.skipped} 个：非「仓库签收」状态）` : ""),
      );
      await load();
      return true;
    } catch {
      toast.error("附加失败，请检查网络后重试");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Inverse of attach: only meaningful while the batch is still at the
  // warehouse (forming/sealed) and the parcel is in_transit on THIS batch.
  const detachParcel = async (p: Parcel) => {
    if (
      !window.confirm(
        `把「${p.member_id} · ${p.description}」移出本批次？包裹会回到「仓库签收」待重新编批。`,
      )
    )
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/shipping/shipments/${id}/detach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel_ids: [p.id] }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        toast.error(errText(err, "移出失败"));
        return;
      }
      const data = (await res.json()) as { updated: number };
      if (data.updated === 0) {
        toast.error("包裹状态已变化，未移出（刷新后重试）");
      } else {
        toast.success("已移出批次，包裹回到「仓库签收」");
      }
      await load();
    } catch {
      toast.error("移出失败，请检查网络后重试");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="p-8 text-sm text-muted-foreground">加载中…</p>;
  }
  if (error || !shipment) {
    return <p className="p-8 text-sm text-rose-600">{error ?? "未找到"}</p>;
  }

  // Detach is only meaningful while the batch is still at the warehouse.
  const canDetach =
    canWrite && (shipment.status === "forming" || shipment.status === "sealed");

  const next = nextShipmentStatus(shipment.status);
  const steps = SHIPMENT_STEPS.map((k) => ({
    key: k,
    label: SHIPMENT_STATUS_LABELS[k],
  }));

  return (
    <div className="space-y-6 p-8">
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
        <Link
          href={`/admin/shipping/shipments/${id}/roster`}
          className="mt-1 inline-block text-sm text-muted-foreground hover:underline"
        >
          取件名单 / 收款 →
        </Link>
      </div>

      {/* Progress */}
      <div className="space-y-3">
        <StatusProgress steps={steps} current={shipment.status} />
        {next && canWrite && (
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
      <ShipmentEditor
        shipment={shipment}
        canWrite={canWrite}
        saving={saving}
        onSave={patchShipment}
      />

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

      {/* Bulk-advance all parcels in this batch (one action → whole flight) */}
      {parcels.length > 0 && canWrite && (
        <BulkAdvancePanel shipmentId={id} parcels={parcels} onDone={load} />
      )}

      {/* Attached parcels + attach flow */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">已关联包裹</h2>
          <div className="flex items-center gap-2">
            {parcels.length > 0 && (
              <a
                href={`/api/admin/shipping/shipments/${id}/export`}
                className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-muted"
              >
                导出 CSV
              </a>
            )}
            {canWrite && (
              <Button
                type="button"
                variant={showAttach ? "outline" : "secondary"}
                onClick={() => setShowAttach((v) => !v)}
              >
                {showAttach ? "取消" : `+ 关联（${unassigned.length} 待关联）`}
              </Button>
            )}
          </div>
        </div>

        {showAttach && (
          <AttachPanel
            unassigned={unassigned}
            saving={saving}
            onAttach={attachSelected}
            onClose={() => setShowAttach(false)}
          />
        )}

        {parcels.length === 0 ? (
          <p className="text-xs text-muted-foreground">这个批次还没有包裹</p>
        ) : (
          <AttachedParcels
            parcels={parcels}
            canDetach={canDetach}
            saving={saving}
            onDetach={detachParcel}
          />
        )}
      </div>
    </div>
  );
}
