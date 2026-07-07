"use client";

// Admin shipment list + inline create form. Ported from bia-roommate
// (Phase-3 slice 4), restyled to shadcn.

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/StatusPill";
import type { Shipment } from "@biboyang425/bia-shared/shipping";
import {
  SHIPMENT_STATUS_TONES,
  shipmentStatusLabel,
} from "@/lib/shipping/labels";
import { fmtDate } from "@/lib/format";
import { useAdminList } from "@/lib/hooks/use-admin-list";

export default function AdminShipmentsPage() {
  const {
    data,
    loading,
    reload,
  } = useAdminList<Shipment[]>("/api/admin/shipping/shipments");
  const shipments = data ?? [];
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [carrier, setCarrier] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const createShipment = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/shipping/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), carrier, notes }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? "创建失败");
        return;
      }
      setName("");
      setCarrier("");
      setNotes("");
      setShowCreate(false);
      toast.success("已创建");
      await reload();
    } catch {
      toast.error("创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">集运 · 批次</h1>
        <Button
          type="button"
          variant={showCreate ? "outline" : "default"}
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "取消" : "+ 新建批次"}
        </Button>
      </header>

      {showCreate && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如 2026-04-20-海运第一批"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="carrier">承运 (可选)</Label>
                <Input
                  id="carrier"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="如 DHL / 顺丰速运"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="notes">备注 (可选)</Label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                />
              </div>
            </div>
            <Button
              type="button"
              onClick={createShipment}
              disabled={!name.trim() || saving}
            >
              {saving ? "创建中…" : "创建"}
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : shipments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          还没有批次。点「+ 新建批次」创建第一个。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {shipments.map((s) => (
            <Link key={s.id} href={`/admin/shipping/shipments/${s.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h3 className="font-medium">{s.name}</h3>
                    <StatusPill
                      tone={SHIPMENT_STATUS_TONES[s.status]}
                      label={shipmentStatusLabel(s.status)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.carrier ? `${s.carrier} · ` : ""}
                    {fmtDate(s.created_at)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
