"use client";

// Shared create/edit form for admin events. eventId present → PATCH (edit),
// absent → POST (create, then redirect to the new event). Used by /new and /[id].

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface EventRecord {
  id?: string;
  title: string;
  description: string | null;
  date: string | null;
  end_date: string | null;
  location: string | null;
  category: string | null;
  capacity: number | null;
  image_url: string | null;
  source_url: string | null;
  status?: string;
}

// ISO timestamptz ⇄ <input type="datetime-local"> (local wall-clock, minute precision).
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export function EventEditor({
  event,
  eventId,
}: {
  event?: EventRecord;
  eventId?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(eventId);

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [date, setDate] = useState(isoToLocal(event?.date ?? null));
  const [endDate, setEndDate] = useState(isoToLocal(event?.end_date ?? null));
  const [location, setLocation] = useState(event?.location ?? "");
  const [category, setCategory] = useState(event?.category ?? "");
  const [capacity, setCapacity] = useState(
    event?.capacity != null ? String(event.capacity) : "",
  );
  const [imageUrl, setImageUrl] = useState(event?.image_url ?? "");
  const [status, setStatus] = useState(event?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setMsg("标题必填");
      return;
    }
    setSaving(true);
    setMsg("");
    const body: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      date: localToIso(date),
      end_date: localToIso(endDate),
      location: location.trim() || null,
      category: category.trim() || null,
      capacity: capacity ? Number(capacity) : null,
      image_url: imageUrl.trim() || null,
    };
    if (isEdit) body.status = status;
    try {
      const res = await fetch(
        isEdit ? `/api/admin/events/${eventId}` : "/api/admin/events",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "保存失败");
      }
      const saved = (await res.json()) as { id?: string };
      setMsg("已保存");
      if (!isEdit && saved?.id) router.push(`/admin/events/${saved.id}`);
      else router.refresh();
    } catch (err) {
      setMsg((err as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-4">
      <Field label="标题">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <Field label="描述">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="开始时间">
          <Input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="结束时间">
          <Input
            type="datetime-local"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
      </div>
      <Field label="地点">
        <Input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="分类">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label="容量">
          <Input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </Field>
      </div>
      <Field label="图片 URL">
        <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
      </Field>
      {isEdit && (
        <Field label="状态">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 w-48 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            <option value="active">active</option>
            <option value="cancelled">cancelled</option>
            <option value="past">past</option>
          </select>
        </Field>
      )}
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={saving}>
          {saving ? "保存中…" : isEdit ? "保存" : "创建"}
        </Button>
        {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
