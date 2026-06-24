"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { roleAtLeast } from "@biboyang425/bia-shared";
import { useRole } from "@/lib/auth/role-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type SponsorTier =
  | "event"
  | "recruiting"
  | "local_service"
  | "payment";

export interface SponsorRow {
  id: string;
  name: string;
  tier: SponsorTier | null;
  contact: string | null;
  logo_url: string | null;
  website_url: string | null;
  notes: string | null;
  active: boolean;
  display_order: number;
  created_at: string;
}

const TIER_LABEL: Record<SponsorTier, string> = {
  event: "活动",
  recruiting: "招聘",
  local_service: "本地服务",
  payment: "支付",
};

const TIER_OPTIONS: { value: SponsorTier; label: string }[] = [
  { value: "event", label: "活动 Event" },
  { value: "recruiting", label: "招聘 Recruiting" },
  { value: "local_service", label: "本地服务 Local service" },
  { value: "payment", label: "支付 Payment" },
];

interface FormState {
  name: string;
  tier: "" | SponsorTier;
  contact: string;
  website_url: string;
  notes: string;
  display_order: string;
  logo_url: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    tier: "",
    contact: "",
    website_url: "",
    notes: "",
    display_order: "0",
    logo_url: "",
  };
}

function fromRow(r: SponsorRow): FormState {
  return {
    name: r.name,
    tier: r.tier ?? "",
    contact: r.contact ?? "",
    website_url: r.website_url ?? "",
    notes: r.notes ?? "",
    display_order: String(r.display_order),
    logo_url: r.logo_url ?? "",
  };
}

export function SponsorsTable({ rows }: { rows: SponsorRow[] }) {
  const router = useRouter();
  const role = useRole();
  const canWrite = roleAtLeast(role, "editor");
  const canDelete = roleAtLeast(role, "super_admin");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SponsorRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (r: SponsorRow) => {
    setEditing(r);
    setForm(fromRow(r));
    setDialogOpen(true);
  };

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (editing) fd.append("id", editing.id);
      const res = await fetch("/api/admin/sponsors/logo-upload", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !json.url) {
        toast.error(json.error ?? "上传失败");
        return;
      }
      setField("logo_url", json.url);
      toast.success("Logo 已上传");
    } catch {
      toast.error("上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error("请填写名称");
      return;
    }
    const order = Number.parseInt(form.display_order, 10);
    const payload = {
      name,
      tier: form.tier === "" ? null : form.tier,
      contact: form.contact.trim() || null,
      website_url: form.website_url.trim() || null,
      notes: form.notes.trim() || null,
      logo_url: form.logo_url.trim() || null,
      display_order: Number.isFinite(order) ? order : 0,
    };

    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/admin/sponsors/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/sponsors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(e.error ?? "保存失败");
        return;
      }
      toast.success(editing ? "已更新" : "已创建");
      setDialogOpen(false);
      router.refresh();
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r: SponsorRow) => {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/admin/sponsors/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !r.active }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(e.error ?? "操作失败");
        return;
      }
      toast.success(r.active ? "已下线" : "已启用");
      router.refresh();
    } catch {
      toast.error("操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const hardDelete = async (r: SponsorRow) => {
    if (!window.confirm(`永久删除赞助方「${r.name}」？此操作不可撤销。`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/admin/sponsors/${r.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(e.error ?? "删除失败");
        return;
      }
      toast.success("已永久删除");
      router.refresh();
    } catch {
      toast.error("删除失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <Button type="button" onClick={openCreate}>
            + 新建赞助方
          </Button>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 px-4">Logo</TableHead>
              <TableHead className="px-4">名称</TableHead>
              <TableHead className="w-28 px-4">分类</TableHead>
              <TableHead className="w-40 px-4">联系</TableHead>
              <TableHead className="w-20 px-4">排序</TableHead>
              <TableHead className="w-20 px-4">状态</TableHead>
              {canWrite && <TableHead className="w-56 px-4">操作</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canWrite ? 7 : 6}
                  className="h-28 px-4 text-center text-sm text-muted-foreground"
                >
                  没有符合条件的赞助方
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => {
                const busy = busyId === s.id;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="px-4 py-3">
                      {s.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.logo_url}
                          alt={s.name}
                          className="h-8 w-8 rounded object-contain"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="font-medium">{s.name}</div>
                      {s.website_url ? (
                        <a
                          href={s.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {s.website_url}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs">
                      {s.tier ? TIER_LABEL[s.tier] : "—"}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate px-4 py-3 text-xs text-muted-foreground">
                      {s.contact ?? "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                      {s.display_order}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs">
                      <span
                        className={
                          s.active
                            ? "text-emerald-600"
                            : "text-muted-foreground"
                        }
                      >
                        {s.active ? "启用" : "已下线"}
                      </span>
                    </TableCell>
                    {canWrite && (
                      <TableCell className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => openEdit(s)}
                          >
                            编辑
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => toggleActive(s)}
                          >
                            {s.active ? "下线" : "启用"}
                          </Button>
                          {canDelete && (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={busy}
                              onClick={() => hardDelete(s)}
                            >
                              删除
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑赞助方" : "新建赞助方"}</DialogTitle>
            <DialogDescription>
              赞助方信息可能展示在 uscbia.com 公开端（仅启用状态）。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="sp-name">名称 *</Label>
              <Input
                id="sp-name"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="赞助方名称"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sp-tier">分类</Label>
              <select
                id="sp-tier"
                value={form.tier}
                onChange={(e) =>
                  setField("tier", e.target.value as FormState["tier"])
                }
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">未分类</option>
                {TIER_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sp-contact">联系方式</Label>
              <Input
                id="sp-contact"
                value={form.contact}
                onChange={(e) => setField("contact", e.target.value)}
                placeholder="邮箱 / 微信 / 电话"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sp-website">网站</Label>
              <Input
                id="sp-website"
                value={form.website_url}
                onChange={(e) => setField("website_url", e.target.value)}
                placeholder="https://"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sp-order">排序（越小越靠前）</Label>
              <Input
                id="sp-order"
                type="number"
                value={form.display_order}
                onChange={(e) => setField("display_order", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Logo</Label>
              <div className="flex items-center gap-3">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.logo_url}
                    alt="logo"
                    className="h-10 w-10 rounded object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    未上传
                  </span>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadLogo(f);
                  }}
                  className="text-xs"
                />
                {uploading && (
                  <span className="text-xs text-muted-foreground">
                    上传中…
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                PNG / JPEG / WebP / GIF，最大 2MB。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sp-notes">备注</Label>
              <textarea
                id="sp-notes"
                value={form.notes}
                onChange={(e) => setField("notes", e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                placeholder="内部备注（不公开）"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button type="button" onClick={save} disabled={saving || uploading}>
              {saving ? "保存中…" : editing ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
