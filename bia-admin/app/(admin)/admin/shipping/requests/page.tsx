"use client";

// Admin list of shipment_requests — status + admin_note editor. Ported from
// bia-roommate (Phase-3 slice 6), restyled to shadcn.

import { useState } from "react";
import { toast } from "sonner";
import { useCanWrite } from "@/lib/auth/role-context";
import { errText, SHIPMENT_REQUEST_STATUS_TONES } from "@/lib/shipping/labels";
import { StatusPill } from "@/components/StatusPill";
import { useAdminList } from "@/lib/hooks/use-admin-list";
import { useDraftMap } from "@/lib/hooks/use-draft-map";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  SHIPMENT_REQUEST_STATUS_LABELS,
  SHIPMENT_REQUEST_STATUS_VALUES,
  SHIPPING_METHOD_META,
  type ShipmentRequest,
  type ShipmentRequestStatus,
} from "@biboyang425/bia-shared/shipping";
import { fmtDate } from "@/lib/format";

type Draft = {
  status?: ShipmentRequestStatus;
  admin_note?: string | null;
};

export default function AdminShipmentRequestsPage() {
  const canWrite = useCanWrite();
  const [filter, setFilter] = useState<ShipmentRequestStatus | "">("");
  const { data, loading, reload } = useAdminList<ShipmentRequest[]>(
    `/api/admin/shipping/requests${filter ? `?status=${filter}` : ""}`,
  );
  const requests = data ?? [];
  const { drafts, update: updateDraft, clear } = useDraftMap<Draft>();
  const [savingId, setSavingId] = useState<string | null>(null);

  const save = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/shipping/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errText(err, "保存失败"));
        return;
      }
      clear(id);
      toast.success("已保存");
      await reload();
    } catch {
      toast.error("保存失败，请检查网络后重试");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6 p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">集运 · 发货请求</h1>
        <p className="text-xs text-muted-foreground">{requests.length} 个申请</p>
      </header>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as ShipmentRequestStatus | "")}
        className="h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
      >
        <option value="">全部状态</option>
        {SHIPMENT_REQUEST_STATUS_VALUES.map((s) => (
          <option key={s} value={s}>
            {SHIPMENT_REQUEST_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无申请</p>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => {
            const draft = drafts[r.id] ?? {};
            const currentStatus = draft.status ?? r.status;
            const dirty =
              (draft.status !== undefined && draft.status !== r.status) ||
              (draft.admin_note !== undefined &&
                draft.admin_note !== r.admin_note);
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
                        {fmtDate(r.created_at)}
                      </p>
                    </div>
                    <StatusPill
                      tone={SHIPMENT_REQUEST_STATUS_TONES[r.status]}
                      label={SHIPMENT_REQUEST_STATUS_LABELS[r.status]}
                    />
                  </div>

                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        申请内容
                      </p>
                      <p className="whitespace-pre-wrap">{r.description}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {r.expected_weight_grams && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            预估重量
                          </p>
                          <p>{(r.expected_weight_grams / 1000).toFixed(1)} kg</p>
                        </div>
                      )}
                      {r.urgency_note && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            时效
                          </p>
                          <p>{r.urgency_note}</p>
                        </div>
                      )}
                      {r.contact && (
                        <div className="col-span-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            联系方式
                          </p>
                          <p>{r.contact}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`status-${r.id}`}>状态</Label>
                      <select
                        id={`status-${r.id}`}
                        value={currentStatus}
                        onChange={(e) =>
                          updateDraft(r.id, {
                            status: e.target.value as ShipmentRequestStatus,
                          })
                        }
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      >
                        {SHIPMENT_REQUEST_STATUS_VALUES.map((s) => (
                          <option key={s} value={s}>
                            {SHIPMENT_REQUEST_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`note-${r.id}`}>管理员备注</Label>
                      <Input
                        id={`note-${r.id}`}
                        value={draft.admin_note ?? r.admin_note ?? ""}
                        onChange={(e) =>
                          updateDraft(r.id, { admin_note: e.target.value })
                        }
                        placeholder="运营备注"
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
