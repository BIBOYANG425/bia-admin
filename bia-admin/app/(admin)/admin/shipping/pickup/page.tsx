"use client";

// Admin pickup 核销 — officer enters the student's pickup code to confirm the
// parcel picked_up (via admin_confirm_pickup_by_token). Dependency-free; the
// camera-scan + student QR is a follow-up once a QR lib can be added.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface VerifyResult {
  member_id: string;
  description?: string | null;
}

export default function AdminPickupVerifyPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/shipping/pickup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        member_id?: string;
        description?: string | null;
      };
      if (!res.ok) {
        setError(data.error ?? "核销失败");
        return;
      }
      setResult({
        member_id: data.member_id ?? "",
        description: data.description,
      });
      setCode("");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">取件核销</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          输入学生出示的取件码，确认取件（picked_up）。仅对「到达美国」的包裹生效。
        </p>
      </div>

      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">输入取件码</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void verify();
            }}
            placeholder="8 位取件码"
            autoFocus
            autoComplete="off"
          />
          <Button onClick={() => void verify()} disabled={busy || !code.trim()}>
            {busy ? "核销中…" : "核销取件"}
          </Button>

          {error && <p className="text-sm text-rose-600">{error}</p>}
          {result && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              ✅ 已确认取件 ·{" "}
              <span className="font-semibold">{result.member_id}</span>
              {result.description ? ` · ${result.description}` : ""}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        提示：相机扫码（学生出示二维码）将在二维码上线后启用；现在用取件码手输即可。
      </p>
    </div>
  );
}
