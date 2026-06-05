"use client";

// Admin editor for shipping contact channels (微信群/个人微信/邮箱/George bot).
// Ported from bia-roommate (Phase-3 slice 8), restyled to shadcn; QR upload now
// goes through the admin-gated /qr-upload endpoint instead of a browser client.

import { useEffect, useState } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type {
  ShippingContact,
  ShippingContactType,
} from "@biboyang425/bia-shared/shipping";

type ContactDraft = Partial<ShippingContact> & { id: string };

const CONTACT_TYPE_LABELS: Record<ShippingContactType, string> = {
  wechat_group: "微信群",
  wechat_personal: "个人微信",
  email: "邮箱",
  george_bot: "George Bot",
};

export default function AdminShippingContactsPage() {
  const [contacts, setContacts] = useState<ShippingContact[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ContactDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/shipping/contacts", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.ok) setContacts((await res.json()) as ShippingContact[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showToast = (msg: string, ms = 1500) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  };

  const patchContact = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/admin/shipping/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, id }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(err.error ?? "保存失败", 1800);
        return;
      }
      const updated = (await res.json()) as ShippingContact;
      setContacts((prev) => prev.map((c) => (c.id === id ? updated : c)));
      setDrafts((prev) => {
        const nextState = { ...prev };
        delete nextState[id];
        return nextState;
      });
      showToast("已保存");
    } finally {
      setSavingId(null);
    }
  };

  const updateDraft = (id: string, patch: Partial<ShippingContact>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { id }), ...patch },
    }));
  };

  const uploadQr = async (id: string, file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      showToast("二维码最大 2MB");
      return;
    }
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("id", id);
      const res = await fetch("/api/admin/shipping/contacts/qr-upload", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        showToast("上传失败：" + (err.error ?? ""), 2000);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      updateDraft(id, { qr_code_url: url });
      showToast("二维码已上传，记得点保存", 2000);
    } finally {
      setUploadingId(null);
    }
  };

  const value = <K extends keyof ShippingContact>(
    c: ShippingContact,
    k: K,
  ): ShippingContact[K] => {
    const draft = drafts[c.id];
    if (draft && k in draft) return draft[k] as ShippingContact[K];
    return c[k];
  };

  if (loading) {
    return <p className="p-8 text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <div className="space-y-6 p-8">
      {toast && (
        <div className="fixed right-4 top-20 z-50 rounded-md border bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">集运 · 联系渠道</h1>
        <p className="text-sm text-muted-foreground">
          微信群、个人微信、邮箱、George bot。值等于「待配置」的渠道不会显示给用户。
        </p>
      </header>

      <div className="space-y-4">
        {contacts.map((c) => {
          const dirty = !!drafts[c.id];
          const qr = value(c, "qr_code_url");
          return (
            <Card key={c.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">
                    {CONTACT_TYPE_LABELS[c.type]}
                    <span className="ml-2 text-xs text-muted-foreground">
                      [{c.type}]
                    </span>
                  </h3>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={value(c, "active")}
                      onChange={(e) =>
                        updateDraft(c.id, { active: e.target.checked })
                      }
                    />
                    active
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>名称 (中文)</Label>
                    <Input
                      value={value(c, "label") ?? ""}
                      onChange={(e) =>
                        updateDraft(c.id, { label: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>名称 (EN)</Label>
                    <Input
                      value={value(c, "label_en") ?? ""}
                      onChange={(e) =>
                        updateDraft(c.id, { label_en: e.target.value || null })
                      }
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>值 (微信号 / 邮箱 / 链接)</Label>
                    <Input
                      value={value(c, "value") ?? ""}
                      onChange={(e) =>
                        updateDraft(c.id, { value: e.target.value })
                      }
                      placeholder="待配置"
                    />
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      值等于「待配置」的联系方式不会向用户展示。
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label>二维码 (仅微信群需要)</Label>
                    <div className="flex items-start gap-3">
                      {qr ? (
                        <Image
                          src={qr as string}
                          alt="QR code"
                          width={80}
                          height={80}
                          unoptimized
                          className="h-20 w-20 shrink-0 rounded-md border object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">
                          无
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-2">
                        <label>
                          <span
                            className={`inline-flex h-8 items-center rounded-md px-3 text-xs font-medium ${
                              uploadingId === c.id
                                ? "cursor-not-allowed bg-muted text-muted-foreground"
                                : "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
                            }`}
                          >
                            {uploadingId === c.id
                              ? "上传中…"
                              : qr
                                ? "替换"
                                : "上传二维码"}
                          </span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={uploadingId === c.id}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadQr(c.id, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {qr && (
                          <button
                            type="button"
                            onClick={() =>
                              updateDraft(c.id, { qr_code_url: null })
                            }
                            className="text-left text-[10px] text-muted-foreground underline"
                          >
                            移除
                          </button>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          PNG / JPG / WEBP · 最大 2MB
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>显示顺序</Label>
                    <Input
                      type="number"
                      value={value(c, "display_order") ?? 0}
                      onChange={(e) =>
                        updateDraft(c.id, {
                          display_order: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() => patchContact(c.id)}
                  disabled={!dirty || savingId === c.id}
                >
                  {savingId === c.id ? "保存中…" : dirty ? "保存" : "未修改"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
