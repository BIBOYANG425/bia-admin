"use client";

// New parcel — officer-side creation for walk-in / un-pre-declared packages.
// POSTs to /api/admin/shipping/parcels (editor+), then redirects to the new
// parcel's detail page. The list/intake flows assume parcels arrive via the
// student declaration; this covers the package that shows up without one.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { useCanWrite } from "@/lib/auth/role-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PARCEL_STATUS_META } from "@biboyang425/bia-shared/shipping";

// Mirrors the POST handler's CREATE_STATUSES — officer creation only seeds a
// pre-international status.
const CREATE_STATUSES = ["expected", "received_cn"] as const;
type CreateStatus = (typeof CREATE_STATUSES)[number];

export default function NewParcelPage() {
  const router = useRouter();
  const canWrite = useCanWrite();

  const [memberId, setMemberId] = useState("");
  const [description, setDescription] = useState("");
  const [trackingCn, setTrackingCn] = useState("");
  const [status, setStatus] = useState<CreateStatus>("expected");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    if (!memberId.trim() || !description.trim()) {
      toast.error("Member ID 和描述必填");
      return;
    }
    setSaving(true);
    try {
      const w = weight.trim();
      const body: Record<string, unknown> = {
        member_id: memberId.trim(),
        description: description.trim(),
        status,
      };
      if (trackingCn.trim()) body.tracking_cn = trackingCn.trim();
      if (w !== "") {
        const grams = Math.round(Number(w));
        if (Number.isFinite(grams) && grams >= 0) body.weight_grams = grams;
      }

      const res = await fetch("/api/admin/shipping/parcels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "创建失败");
        return;
      }
      toast.success("已创建包裹");
      if (data.id) {
        router.push(`/admin/shipping/parcels/${data.id}`);
      } else {
        router.push("/admin/shipping/parcels");
      }
    } catch {
      toast.error("创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6 p-8">
      <div>
        <Link
          href="/admin/shipping/parcels"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← 包裹列表
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">新建包裹</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          为走件 / 未预报的包裹手动建档（学生未在小程序登记时使用）。
        </p>
      </div>

      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">包裹信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <div className="space-y-1">
            <Label htmlFor="member_id">Member ID *</Label>
            <Input
              id="member_id"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              placeholder="如 BIA-1234 / 微信号"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">描述 *</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="如 衣服一箱 / 电子产品"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tracking_cn">国内单号（可选）</Label>
              <Input
                id="tracking_cn"
                value={trackingCn}
                onChange={(e) => setTrackingCn(e.target.value)}
                placeholder="SF1234567890"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="weight">重量 (克，可选)</Label>
              <Input
                id="weight"
                type="number"
                inputMode="numeric"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="status">初始状态</Label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as CreateStatus)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {CREATE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PARCEL_STATUS_META[s].label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                选「仓库签收」会自动记录签收时间。其余流转请在详情页推进。
              </p>
            </div>
          </div>
          {canWrite ? (
            <Button type="button" onClick={submit} disabled={saving}>
              {saving ? "创建中…" : "创建包裹"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">只读：无法创建</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
