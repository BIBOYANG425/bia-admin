"use client";

// Admin editor for shipping routes (专线) — price, schedule, labels. Saves are
// immediately user-visible. `method` is not editable (retire via active=false).
// Ported from bia-roommate (Phase-3 slice 7), restyled to shadcn.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCanWrite } from "@/lib/auth/role-context";
import { errText } from "@/lib/shipping/labels";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  SHIPPING_METHOD_META,
  SHIPPING_METHOD_ORDER,
  type ShippingRoute,
} from "@biboyang425/bia-shared/shipping";

type RouteDraft = Partial<ShippingRoute> & { id: string };

export default function AdminShippingRoutesPage() {
  const canWrite = useCanWrite();
  const [routes, setRoutes] = useState<ShippingRoute[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RouteDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/shipping/routes", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as ShippingRoute[];
          setRoutes(
            [...data].sort(
              (a, b) =>
                (SHIPPING_METHOD_ORDER[a.method] ?? 99) -
                (SHIPPING_METHOD_ORDER[b.method] ?? 99),
            ),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchRoute = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/admin/shipping/routes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, id }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errText(err, "保存失败"));
        return;
      }
      const updated = (await res.json()) as ShippingRoute;
      setRoutes((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setDrafts((prev) => {
        const nextState = { ...prev };
        delete nextState[id];
        return nextState;
      });
      toast.success("已保存");
    } catch {
      toast.error("保存失败，请检查网络后重试");
    } finally {
      setSavingId(null);
    }
  };

  const updateDraft = (id: string, patch: Partial<ShippingRoute>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { id }), ...patch },
    }));
  };

  const value = <K extends keyof ShippingRoute>(
    r: ShippingRoute,
    k: K,
  ): ShippingRoute[K] => {
    const draft = drafts[r.id];
    if (draft && k in draft) return draft[k] as ShippingRoute[K];
    return r[k];
  };

  if (loading) {
    return <p className="p-8 text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <div className="space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">集运 · 专线</h1>
        <p className="text-sm text-muted-foreground">
          修改发货日程、价格和参考报价。保存后立即对用户可见。
        </p>
      </header>

      <div className="space-y-4">
        {routes.map((r) => {
          const meta = SHIPPING_METHOD_META[r.method];
          const dirty = !!drafts[r.id];
          return (
            <Card key={r.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">
                    <span className="mr-2">{meta.icon}</span>
                    {r.label}
                    <span className="ml-2 text-xs text-muted-foreground">
                      [{r.method}]
                    </span>
                  </h3>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={value(r, "active")}
                      onChange={(e) =>
                        updateDraft(r.id, { active: e.target.checked })
                      }
                    />
                    active
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>名称 label</Label>
                    <Input
                      value={value(r, "label") ?? ""}
                      onChange={(e) =>
                        updateDraft(r.id, { label: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>单价/kg (CNY)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={value(r, "price_per_kg_cny") ?? ""}
                      onChange={(e) =>
                        updateDraft(r.id, {
                          price_per_kg_cny:
                            e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>下次发车</Label>
                    <Input
                      type="date"
                      value={value(r, "next_departure_date") ?? ""}
                      onChange={(e) =>
                        updateDraft(r.id, {
                          next_departure_date: e.target.value || null,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>预计到达</Label>
                    <Input
                      type="date"
                      value={value(r, "estimated_arrival_date") ?? ""}
                      onChange={(e) =>
                        updateDraft(r.id, {
                          estimated_arrival_date: e.target.value || null,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>运输天数</Label>
                    <Input
                      type="number"
                      value={value(r, "transit_days_estimate") ?? ""}
                      onChange={(e) =>
                        updateDraft(r.id, {
                          transit_days_estimate:
                            e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>截单提示</Label>
                    <Input
                      value={value(r, "cutoff_note") ?? ""}
                      onChange={(e) =>
                        updateDraft(r.id, {
                          cutoff_note: e.target.value || null,
                        })
                      }
                      placeholder="如：本周日截单"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>频率标签</Label>
                    <Input
                      value={value(r, "frequency_label") ?? ""}
                      onChange={(e) =>
                        updateDraft(r.id, {
                          frequency_label: e.target.value || null,
                        })
                      }
                      placeholder="如：每周发车 / 双周发车"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>备注</Label>
                    <textarea
                      value={value(r, "notes") ?? ""}
                      onChange={(e) =>
                        updateDraft(r.id, { notes: e.target.value || null })
                      }
                      rows={2}
                      className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() => patchRoute(r.id)}
                  disabled={!canWrite || !dirty || savingId === r.id}
                >
                  {savingId === r.id ? "保存中…" : dirty ? "保存" : "未修改"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {routes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            还没有专线。请先跑 shipping_routes migration。
          </p>
        )}
      </div>
    </div>
  );
}
