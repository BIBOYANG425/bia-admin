"use client";

// Bulk intake — paste CN tracking numbers → match to 'expected' parcels →
// review (with inline weights + select-all) → confirm receive (-> received_cn).
// Self-contained: no refactor of the server-rendered parcels list. The receive
// step takes an explicit id list and is forward-only, so it can't mass
// mis-transition.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface MatchParcel {
  id: string;
  member_id: string;
  description: string;
  tracking_cn: string | null;
  weight_grams: number | null;
}

export default function BulkIntakePage() {
  const [raw, setRaw] = useState("");
  const [matched, setMatched] = useState<MatchParcel[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [ambiguous, setAmbiguous] = useState<{ code: string; ids: string[] }[]>(
    [],
  );
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [matching, setMatching] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doMatch = async () => {
    const codes = raw
      .split(/[\s,，、]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (codes.length === 0 || matching) return;
    setMatching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/shipping/parcels/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        matched?: MatchParcel[];
        unmatched?: string[];
        ambiguous?: { code: string; ids: string[] }[];
      };
      if (!res.ok) {
        setError(data.error ?? "匹配失败");
        return;
      }
      const m = data.matched ?? [];
      setMatched(m);
      setUnmatched(data.unmatched ?? []);
      setAmbiguous(data.ambiguous ?? []);
      setSelected(new Set(m.map((p) => p.id)));
      setWeights(
        Object.fromEntries(
          m.map((p) => [
            p.id,
            p.weight_grams != null ? String(p.weight_grams) : "",
          ]),
        ),
      );
    } catch {
      setError("匹配失败");
    } finally {
      setMatching(false);
    }
  };

  const doReceive = async () => {
    const items = matched
      .filter((m) => selected.has(m.id))
      .map((m) => {
        const w = (weights[m.id] ?? "").trim();
        const grams = w === "" ? undefined : Math.round(Number(w));
        return {
          id: m.id,
          weight_grams:
            grams != null && Number.isFinite(grams) && grams >= 0
              ? grams
              : undefined,
        };
      });
    if (items.length === 0 || receiving) return;
    if (!confirm(`确认入库 ${items.length} 个包裹？`)) return;
    setReceiving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/shipping/parcels/bulk-receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        updated?: number;
        skipped?: number;
        failed?: number;
      };
      if (!res.ok) {
        setError(data.error ?? "入库失败");
        return;
      }
      setResult(
        `已入库 ${data.updated ?? 0}（跳过 ${data.skipped ?? 0} / 失败 ${data.failed ?? 0}）`,
      );
      // Drop the received rows from the review list.
      const done = new Set(items.map((i) => i.id));
      setMatched((prev) => prev.filter((m) => !done.has(m.id)));
      setSelected(new Set());
    } catch {
      setError("入库失败");
    } finally {
      setReceiving(false);
    }
  };

  const allSelected = matched.length > 0 && selected.size === matched.length;

  return (
    <div className="max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">批量入库</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          粘贴国内单号（每行一个或逗号分隔）→ 匹配「待入库」包裹 → 核对后一键入库（
          received_cn）。只对已填国内单号的包裹生效。
        </p>
      </div>

      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">粘贴单号</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={5}
            placeholder={"SF1234567890\nYT9876543210\n…"}
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
          />
          <Button onClick={doMatch} disabled={matching || !raw.trim()}>
            {matching ? "匹配中…" : "匹配"}
          </Button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {result && <p className="text-sm text-emerald-700">{result}</p>}
        </CardContent>
      </Card>

      {matched.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(matched.map((m) => m.id))
                      : new Set(),
                  )
                }
              />
              全选 · 已选 {selected.size} / {matched.length}
            </label>
            <Button onClick={doReceive} disabled={receiving || selected.size === 0}>
              {receiving ? "入库中…" : `确认入库 ${selected.size} 个`}
            </Button>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 px-4"></TableHead>
                  <TableHead className="px-4">Member</TableHead>
                  <TableHead className="px-4">描述</TableHead>
                  <TableHead className="px-4">单号</TableHead>
                  <TableHead className="w-28 px-4">重量(g)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matched.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(m.id)) next.delete(m.id);
                            else next.add(m.id);
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="px-4 py-2 font-medium">
                      {m.member_id}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate px-4 py-2">
                      {m.description}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                      {m.tracking_cn ?? "—"}
                    </TableCell>
                    <TableCell className="px-4 py-2">
                      <Input
                        value={weights[m.id] ?? ""}
                        onChange={(e) =>
                          setWeights((prev) => ({
                            ...prev,
                            [m.id]: e.target.value,
                          }))
                        }
                        inputMode="numeric"
                        placeholder="—"
                        className="h-8 w-24"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {ambiguous.length > 0 && (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base text-amber-700">
              多个匹配（需手动处理 {ambiguous.length}）
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-sm text-muted-foreground">
            以下单号对应多个待入库包裹，请到包裹列表手动入库：
            <div className="mt-2 font-mono text-xs">
              {ambiguous.map((a) => a.code).join("、")}
            </div>
          </CardContent>
        </Card>
      )}

      {unmatched.length > 0 && (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base text-muted-foreground">
              未匹配（{unmatched.length}）
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-sm text-muted-foreground">
            没找到「待入库」且单号一致的包裹（可能学生还没填单号，或已入库）：
            <div className="mt-2 font-mono text-xs">{unmatched.join("、")}</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
