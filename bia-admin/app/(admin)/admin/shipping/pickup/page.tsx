"use client";

// Admin pickup 核销 — officer confirms a parcel picked_up via the student's
// pickup token (admin_confirm_pickup_by_token). Two input modes share ONE
// verify path: manual 8-char entry (always available, the default) and camera
// QR scan (PickupScanner decodes the student's QR down to the same token).

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PickupScanner } from "./PickupScanner";

interface VerifyResult {
  member_id: string;
  description?: string | null;
}

type Mode = "manual" | "scan";

export default function AdminPickupVerifyPage() {
  const [mode, setMode] = useState<Mode>("manual");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = async (raw: string) => {
    const c = raw.trim();
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
        const msg = data.error ?? "核销失败";
        setError(msg);
        toast.error(msg);
        return;
      }
      const r: VerifyResult = {
        member_id: data.member_id ?? "",
        description: data.description,
      };
      setResult(r);
      setCode("");
      toast.success(`已确认取件 · ${r.member_id}`);
    } catch {
      const msg = "网络错误，请重试";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="max-w-md space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">取件核销</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          扫描或输入学生出示的取件码，确认取件（picked_up）。仅对「到达美国」的包裹生效。
        </p>
      </div>

      <Card>
        <CardHeader className="p-4">
          <div
            className="inline-flex rounded-md border p-0.5"
            role="tablist"
            aria-label="核销方式"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "scan"}
              onClick={() => switchMode("scan")}
              className={`rounded px-3 py-1 text-sm font-medium ${
                mode === "scan"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              扫码
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "manual"}
              onClick={() => switchMode("manual")}
              className={`rounded px-3 py-1 text-sm font-medium ${
                mode === "manual"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              手输
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {mode === "scan" ? (
            <PickupScanner
              busy={busy}
              onToken={(t) => {
                setCode(t);
                void verify(t);
              }}
            />
          ) : (
            <>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void verify(code);
                }}
                placeholder="8 位取件码"
                autoFocus
                autoComplete="off"
              />
              <Button
                onClick={() => void verify(code)}
                disabled={busy || !code.trim()}
              >
                {busy ? "核销中…" : "核销取件"}
              </Button>
            </>
          )}

          {error && (
            <p className="text-sm text-rose-600" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div
              role="status"
              className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
            >
              ✅ 已确认取件 ·{" "}
              <span className="font-semibold">{result.member_id}</span>
              {result.description ? ` · ${result.description}` : ""}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
