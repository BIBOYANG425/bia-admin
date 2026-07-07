"use client";

// Admin view of user-initiated pack requests (regular consolidation flow).
// Ported from bia-roommate (Phase-3 slice 5), restyled to shadcn.

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useCanWrite } from "@/lib/auth/role-context";
import {
  PACK_REQUEST_STATUS_TONES,
  shipmentStatusLabel,
} from "@/lib/shipping/labels";
import { StatusPill } from "@/components/StatusPill";
import { useAdminList } from "@/lib/hooks/use-admin-list";
import { useDraftMap } from "@/lib/hooks/use-draft-map";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  PACK_REQUEST_STATUS_LABELS,
  PACK_REQUEST_STATUS_VALUES,
  SHIPPING_METHOD_META,
  type PackRequestStatus,
  type PackRequestWithParcels,
  type Shipment,
} from "@biboyang425/bia-shared/shipping";
import { fmtDate } from "@/lib/format";

type Draft = {
  status?: PackRequestStatus;
  admin_note?: string | null;
  shipment_id?: string | null;
};

// Batches still accepting parcels — past departed_cn they're already moving.
const OPEN_SHIPMENT_STATUSES = ["forming", "sealed"] as const;

export default function AdminPackRequestsPage() {
  const canWrite = useCanWrite();
  const [filter, setFilter] = useState<PackRequestStatus | "">("");
  const {
    data: reqData,
    loading,
    reload: reloadRequests,
  } = useAdminList<PackRequestWithParcels[]>(
    `/api/admin/shipping/pack-requests${filter ? `?status=${filter}` : ""}`,
  );
  const { data: shipData, reload: reloadShipments } = useAdminList<Shipment[]>(
    "/api/admin/shipping/shipments",
  );
  const requests = reqData ?? [];
  const shipments = (shipData ?? []).filter((s) =>
    OPEN_SHIPMENT_STATUSES.includes(
      s.status as (typeof OPEN_SHIPMENT_STATUSES)[number],
    ),
  );
  const reload = async () => {
    await Promise.all([reloadRequests(), reloadShipments()]);
  };

  const { drafts, update: updateDraft, clear } = useDraftMap<Draft>();
  const [pickedShipment, setPickedShipment] = useState<Record<string, string>>(
    {},
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  const attachToShipment = async (requestId: string) => {
    const shipmentId = pickedShipment[requestId];
    if (!shipmentId) return;
    setAttachingId(requestId);
    try {
      const res = await fetch(
        `/api/admin/shipping/pack-requests/${requestId}/attach`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipment_id: shipmentId }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? "附加失败");
        return;
      }
      const data = (await res.json()) as {
        attached: number;
        skipped?: number;
        approved?: boolean;
      };
      if (data.approved) {
        toast.success(`已附加 ${data.attached} 个包裹 · 申请已标记 approved`);
      } else {
        // Partial attach: the request stays attachable — tell the officer to
        // re-run after the remaining parcels are received (SR-1).
        toast.warning(
          `已附加 ${data.attached} 个包裹 · 跳过 ${data.skipped ?? 0} 个（非「仓库签收」状态）。` +
            "申请未标记 approved — 其余包裹入库后请再次「拍进批次」。",
        );
      }
      setPickedShipment((prev) => {
        const nextState = { ...prev };
        delete nextState[requestId];
        return nextState;
      });
      await reload();
    } catch {
      toast.error("附加失败");
    } finally {
      setAttachingId(null);
    }
  };

  const save = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/shipping/pack-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? "保存失败");
        return;
      }
      clear(id);
      toast.success("已保存");
      await reload();
    } catch {
      toast.error("保存失败");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6 p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">集运 · 打包申请</h1>
        <p className="text-xs text-muted-foreground">
          {requests.length} 个申请 · 常规拼单流程
        </p>
      </header>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as PackRequestStatus | "")}
        className="h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
      >
        <option value="">全部状态</option>
        {PACK_REQUEST_STATUS_VALUES.map((s) => (
          <option key={s} value={s}>
            {PACK_REQUEST_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无打包申请</p>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => {
            const draft = drafts[r.id] ?? {};
            const currentStatus = draft.status ?? r.status;
            const dirty =
              (draft.status !== undefined && draft.status !== r.status) ||
              (draft.admin_note !== undefined &&
                draft.admin_note !== r.admin_note) ||
              (draft.shipment_id !== undefined &&
                draft.shipment_id !== r.shipment_id);
            return (
              <Card key={r.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {r.member_id ?? "(未绑 member)"}
                        {r.preferred_method && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            · {SHIPPING_METHOD_META[r.preferred_method].icon}{" "}
                            {SHIPPING_METHOD_META[r.preferred_method].label}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {fmtDate(r.created_at)} ·{" "}
                        <strong>{r.parcels?.length ?? 0}</strong> 个包裹
                      </p>
                    </div>
                    <StatusPill
                      tone={PACK_REQUEST_STATUS_TONES[r.status]}
                      label={PACK_REQUEST_STATUS_LABELS[r.status]}
                    />
                  </div>

                  {r.parcels && r.parcels.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        包含包裹
                      </p>
                      <div className="space-y-1 text-sm">
                        {r.parcels.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center gap-2 rounded-md border bg-muted/40 p-2"
                          >
                            <Link
                              href={`/admin/shipping/parcels/${p.id}`}
                              className="text-xs font-medium hover:underline"
                            >
                              {p.member_id}
                            </Link>
                            <span className="min-w-0 flex-1 truncate">
                              {p.description}
                            </span>
                            {p.weight_grams && (
                              <span className="text-[11px] text-muted-foreground">
                                {(p.weight_grams / 1000).toFixed(1)} kg
                              </span>
                            )}
                            {p.shipping_method && (
                              <span className="text-xs text-muted-foreground">
                                {SHIPPING_METHOD_META[p.shipping_method].icon}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    {r.urgency_note && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          时效
                        </p>
                        <p>{r.urgency_note}</p>
                      </div>
                    )}
                    {r.contact && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          联系方式
                        </p>
                        <p>{r.contact}</p>
                      </div>
                    )}
                    {r.user_note && (
                      <div className="sm:col-span-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          用户备注
                        </p>
                        <p>{r.user_note}</p>
                      </div>
                    )}
                  </div>

                  {/* Attach-to-batch (only pending / contacted) */}
                  {(r.status === "pending" || r.status === "contacted") &&
                    (shipments.length > 0 ? (
                      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                        <p className="text-[11px] text-amber-900">
                          拍进现有批次（自动把这些包裹关联到批次并推进到
                          in_transit）
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <select
                            value={pickedShipment[r.id] ?? ""}
                            onChange={(e) =>
                              setPickedShipment((prev) => ({
                                ...prev,
                                [r.id]: e.target.value,
                              }))
                            }
                            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                          >
                            <option value="">选一个批次…</option>
                            {shipments.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}（{shipmentStatusLabel(s.status)}）
                                {s.carrier ? ` · ${s.carrier}` : ""}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            className="shrink-0"
                            onClick={() => attachToShipment(r.id)}
                            disabled={
                              !canWrite ||
                              !pickedShipment[r.id] ||
                              attachingId === r.id
                            }
                          >
                            {attachingId === r.id ? "处理中…" : "拍进批次"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-3">
                        <p className="text-xs text-muted-foreground">
                          目前没有 forming / sealed 状态的批次。
                        </p>
                        <Link
                          href="/admin/shipping/shipments"
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          先去创建一个批次 →
                        </Link>
                      </div>
                    ))}

                  {r.shipment_id && (
                    <div className="rounded-md border bg-muted/40 p-3">
                      <p className="text-[11px] text-muted-foreground">
                        已关联批次 ·{" "}
                        <Link
                          href={`/admin/shipping/shipments/${r.shipment_id}`}
                          className="font-medium hover:underline"
                        >
                          查看批次 →
                        </Link>
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`status-${r.id}`}>状态</Label>
                      <select
                        id={`status-${r.id}`}
                        value={currentStatus}
                        onChange={(e) =>
                          updateDraft(r.id, {
                            status: e.target.value as PackRequestStatus,
                          })
                        }
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      >
                        {PACK_REQUEST_STATUS_VALUES.map((s) => (
                          <option key={s} value={s}>
                            {PACK_REQUEST_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor={`note-${r.id}`}>
                        管理员备注（用户能看到）
                      </Label>
                      <Input
                        id={`note-${r.id}`}
                        value={draft.admin_note ?? r.admin_note ?? ""}
                        onChange={(e) =>
                          updateDraft(r.id, { admin_note: e.target.value })
                        }
                        placeholder="如：已加进周五的海运批次，周四上午会安排打包"
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={() => save(r.id)}
                    disabled={!canWrite || !dirty || savingId === r.id}
                  >
                    {savingId === r.id ? "保存中…" : dirty ? "保存" : "未修改"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
