import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { EventEditor } from "../EventEditor";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  await requireRole("editor");
  return (
    <div className="p-8 space-y-6">
      <Link
        href="/admin/events"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← 活动
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">新建活动</h1>
      <EventEditor />
    </div>
  );
}
