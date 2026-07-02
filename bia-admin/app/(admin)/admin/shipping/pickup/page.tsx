"use client";

// Admin pickup 核销 — officer confirms a parcel picked_up via the student's
// pickup token (admin_confirm_pickup_by_token). Two input modes share ONE
// verify path: manual 8-char entry (always available, the default) and camera
// QR scan (PickupScanner decodes the student's QR down to the same token).
// SR-2: unpaid parcels HOLD the confirm behind an unmissable banner (D2), the
// success card lists the student's remaining arrived_us parcels, and the
// scanner re-arms itself after each outcome so a 3-parcel pickup is 3 scans.

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PickupScanner } from "./PickupScanner";

interface RemainingParcel {
  id: string;
  description: string | null;
  /** amount_owed_cents when the parcel still owes money, else null. */
  unpaid: number | null;
}

interface VerifyResult {
  member_id: string;
  description?: string | null;
  unpaid_confirmed?: number | null;
  remaining?: RemainingParcel[];
}

interface PaymentHold {
  code: string;
  member_id: string;
  description?: string | null;
  amount_owed_cents: number;
}

type Mode = "manual" | "scan";

function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function AdminPickupVerifyPage() {
  const [mode, setMode] = useState<Mode>("manual");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hold, setHold] = useState<PaymentHold | null>(null);
  // Bumped after each final outcome so the scanner re-arms itself.
  const [rearm, setRearm] = useState(0);

  const verify = async (raw: string, force = false) => {
    const c = raw.trim();
    if (!c || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    if (!force) setHold(null);
    let finalOutcome = true;
    try {
      const res = await fetch("/api/admin/shipping/pickup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c, force }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        member_id?: string;
        description?: string | null;
        requires_payment?: boolean;
        amount_owed_cents?: number;
        unpaid_confirmed?: number | null;
        remaining?: RemainingParcel[];
      };
      if (!res.ok) {
        const msg = data.message ?? data.error ?? "核销失败";
        setError(msg);
        toast.error(msg);
        return;
      }
      if (data.requires_payment) {
        // D2: money due at the hand-off — hold the confirm until the officer
        // explicitly proceeds. Not a final outcome; keep the scanner paused.
        finalOutcome = false;
        setHold({
          code: c,
          member_id: data.member_id ?? "",
          description: data.description,
          amount_owed_cents: data.amount_owed_cents ?? 0,
        });
        return;
      }
      setHold(null);
      const r: VerifyResult = {
        member_id: data.member_id ?? "",
        description: data.description,
        unpaid_confirmed: data.unpaid_confirmed,
        remaining: data.remaining ?? [],
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
      if (finalOutcome) setRearm((n) => n + 1);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setHold(null);
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
              rearmSignal={rearm}
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

          {hold && (
            <div
              role="alert"
              className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <p className="font-semibold">
                ⚠️ 未付款 · 应收 {yuan(hold.amount_owed_cents)}
              </p>
              <p className="mt-1">
                {hold.member_id}
                {hold.description ? ` · ${hold.description}` : ""}
                ，请先向学生收款（默认现金）。核销后请到批次名册记录收款。
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void verify(hold.code, true)}
                  disabled={busy}
                >
                  已收款 / 仍然核销
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setHold(null);
                    setRearm((n) => n + 1);
                  }}
                  disabled={busy}
                >
                  取消
                </Button>
              </div>
            </div>
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
              {result.unpaid_confirmed != null && (
                <p className="mt-1 font-medium text-amber-700">
                  ⚠️ 该包裹未记录收款（应收 {yuan(result.unpaid_confirmed)}
                  ）——请到批次名册补记。
                </p>
              )}
              {result.remaining && result.remaining.length > 0 && (
                <div className="mt-2 border-t border-emerald-200 pt-2">
                  <p className="font-medium">
                    该学生还有 {result.remaining.length} 件待取：
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
                    {result.remaining.map((p) => (
                      <li key={p.id}>
                        {p.description ?? p.id.slice(0, 8)}
                        {p.unpaid != null && (
                          <span className="ml-1 text-amber-700">
                            （未付 {yuan(p.unpaid)}）
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    继续扫下一件即可。
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
