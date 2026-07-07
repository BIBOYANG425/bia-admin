"use client";

// Delete control for the event detail header (super_admin only — the page
// gates rendering on role). Confirms, DELETEs /api/admin/events/[id] (which
// also drops attendance rows), then routes back to the events list.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function DeleteEventButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm("删除这个活动？将同时移除其报名/签到记录，不可撤销。"))
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "删除失败");
        return;
      }
      toast.success("已删除");
      router.push("/admin/events");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={deleting}
      onClick={handleDelete}
    >
      {deleting ? "删除中…" : "删除活动"}
    </Button>
  );
}
