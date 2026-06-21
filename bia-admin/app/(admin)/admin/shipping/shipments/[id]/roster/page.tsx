"use client";

// Per-shipment pickup roster + offline payment reconciliation. Reuses the
// shipment GET (its parcels select('*') now carries the payment columns) and
// writes via the per-parcel payment route. Amounts shown/edited in ¥ (major
// units), stored as cents.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaidPill } from "@/components/shipping/PaidPill";
import type { Parcel, Shipment } from "@biboyang425/bia-shared/shipping";

function yuan(cents: number | null | undefined): string {
  return cents == null ? "0.00" : (cents / 100).toFixed(2);
}

export default function ShipmentRosterPage() {
  const { id } = useParams<{ id: string }>();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/shipping/shipments/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(res.status === 404 ? "批次不存在" : "加载失败");
        return;
      }
      const data = (await res.json()) as {
        shipment: Shipment;
        parcels: Parcel[];
      };
      setShipment(data.shipment);
      setParcels(
        (data.parcels ?? [])
          .slice()
          .sort((a, b) => (a.member_id || "").localeCompare(b.member_id || "")),
      );
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

  const patchPayment = async (pid: string, patch: Record<string, unknown>) => {
    setSavingId(pid);
    try {
      const res = await fetch(`/api/admin/shipping/parcels/${pid}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated = (await res.json()) as Parcel;
        setParcels((prev) =>
          prev.map((p) => (p.id === pid ? { ...p, ...updated } : p)),
        );
        flash("已保存");
      } else {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        flash(e.error ?? "保存失败");
      }
    } catch {
      flash("保存失败");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <p className="p-8 text-sm text-muted-foreground">加载中…</p>;
  }
  if (error || !shipment) {
    return <p className="p-8 text-sm text-rose-600">{error ?? "未找到"}</p>;
  }

  const totalOwed = parcels.reduce(
    (s, p) => s + (p.amount_owed_cents ?? 0),
    0,
  );
  const paidCount = parcels.filter((p) => p.paid_at).length;

  return (
    <div className="space-y-6 p-8">
      {toast && (
        <div className="fixed right-4 top-20 z-50 rounded-md border bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <div>
        <Link
          href={`/admin/shipping/shipments/${id}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← 批次详情
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {shipment.name} · 取件名单 / 收款
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {parcels.length} 个包裹 · 已收款 {paidCount}/{parcels.length} · 应收合计 ¥
          {yuan(totalOwed)}（线下当面 / 转账，本平台不收银）
        </p>
        <a
          href={`/api/admin/shipping/shipments/${id}/export`}
          className="mt-2 inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-muted"
        >
          导出 CSV
        </a>
      </div>

      {parcels.length === 0 ? (
        <p className="text-xs text-muted-foreground">这个批次还没有包裹</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">Member</TableHead>
                <TableHead className="px-4">描述</TableHead>
                <TableHead className="w-20 px-4">重量</TableHead>
                <TableHead className="w-28 px-4">应收 (¥)</TableHead>
                <TableHead className="w-48 px-4">收款</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parcels.map((p) => (
                <RosterRow
                  key={p.id}
                  parcel={p}
                  saving={savingId === p.id}
                  onPatch={patchPayment}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function RosterRow({
  parcel,
  saving,
  onPatch,
}: {
  parcel: Parcel;
  saving: boolean;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [amount, setAmount] = useState(
    parcel.amount_owed_cents != null
      ? (parcel.amount_owed_cents / 100).toFixed(2)
      : "",
  );
  const paid = !!parcel.paid_at;
  const weightKg = parcel.weight_grams
    ? `${(parcel.weight_grams / 1000).toFixed(1)} kg`
    : "—";

  const saveAmount = () => {
    const trimmed = amount.trim();
    const cents = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
    if (trimmed !== "" && (cents === null || !Number.isFinite(cents) || cents < 0)) {
      return; // ignore invalid input
    }
    const current = parcel.amount_owed_cents ?? null;
    if (cents === current) return;
    onPatch(parcel.id, { amount_owed_cents: cents });
  };

  return (
    <TableRow>
      <TableCell className="px-4 py-2">
        <Link
          href={`/admin/shipping/parcels/${parcel.id}`}
          className="font-medium hover:underline"
        >
          {parcel.member_id}
        </Link>
      </TableCell>
      <TableCell className="max-w-[200px] truncate px-4 py-2">
        {parcel.description}
      </TableCell>
      <TableCell className="px-4 py-2 text-xs text-muted-foreground">
        {weightKg}
      </TableCell>
      <TableCell className="px-4 py-2">
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={saveAmount}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          inputMode="decimal"
          placeholder="—"
          className="h-8 w-24"
        />
      </TableCell>
      <TableCell className="px-4 py-2">
        <div className="flex items-center gap-2">
          <PaidPill paid={paid} />
          <Button
            type="button"
            variant={paid ? "outline" : "secondary"}
            size="sm"
            disabled={saving}
            onClick={() => onPatch(parcel.id, { paid: !paid })}
          >
            {paid ? "撤销" : "标记已收"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
