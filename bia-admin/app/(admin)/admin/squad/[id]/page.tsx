import Link from "next/link";
import { notFound } from "next/navigation";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth/require-role";
import {
  squadStatusLabel,
  squadStatusPillClass,
  tallyPingOutcomes,
  type SquadMemberRow,
  type SquadPingRow,
  type SquadPostRow,
} from "@/lib/squad/status";
import { SquadModeration } from "./SquadModeration";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function AdminSquadDetailPage({ params }: PageProps) {
  await requireRole("viewer");
  const { id } = await params;

  const admin = createBiaServiceRoleClient();

  const { data: post, error: postErr } = await admin
    .from("squad_posts_with_status")
    .select(
      "id, category, content, location, contact, poster_name, tags, status, current_people, max_people, deadline, created_at, created_via, cancelled_at, completed_at, needs_refill, user_id, created_by_student_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (postErr) {
    throw new Error(`Failed to load squad post: ${postErr.message}`);
  }
  if (!post) notFound();
  const p = post as SquadPostRow;

  const [{ data: memberData }, { data: pingData }] = await Promise.all([
    admin
      .from("squad_members")
      .select("id, post_id, user_id, student_id, rsvp_status, rsvp_at, created_at")
      .eq("post_id", id)
      .order("created_at", { ascending: true }),
    admin
      .from("squad_pings")
      .select("id, post_id, status, response")
      .eq("post_id", id),
  ]);

  const members = (memberData ?? []) as SquadMemberRow[];
  const pings = (pingData ?? []) as SquadPingRow[];
  const outcomes = tallyPingOutcomes(pings);

  // Resolve display names for student-keyed members (privacy-safe: members are
  // the people who already joined THIS post — the organizer can see them).
  const studentIds = members
    .map((m) => m.student_id)
    .filter((x): x is string => Boolean(x));
  const names = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: students } = await admin
      .from("students")
      .select("id, name, member_id")
      .in("id", studentIds);
    for (const s of (students ?? []) as {
      id: string;
      name: string | null;
      member_id: string | null;
    }[]) {
      names.set(s.id, s.name ?? s.member_id ?? s.id.slice(0, 8));
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/squad"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Squad 列表
          </Link>
          <h1 className="mt-1 max-w-2xl text-2xl font-bold tracking-tight">
            {(p.content ?? "").trim() || (p.category ? `[${p.category}]` : "（无内容）")}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {p.poster_name && <span className="font-medium">{p.poster_name}</span>}
            {p.category && <span>· {p.category}</span>}
            {p.location && <span>· {p.location}</span>}
            <span>· 来源 {p.created_via ?? "web"}</span>
          </div>
        </div>
        <span className={squadStatusPillClass(p.status)}>
          {squadStatusLabel(p.status)}
        </span>
      </div>

      {/* Post details */}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">局信息</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 pt-0 text-sm sm:grid-cols-2">
          <Field label="状态" value={squadStatusLabel(p.status)} />
          <Field
            label="人数"
            value={`${p.current_people ?? 0} / ${p.max_people ?? "—"}`}
          />
          <Field label="类别" value={p.category ?? "—"} />
          <Field label="地点" value={p.location ?? "—"} />
          <Field label="联系" value={p.contact ?? "—"} />
          <Field label="截止" value={fmtDate(p.deadline)} />
          <Field label="创建" value={fmtDate(p.created_at)} />
          <Field
            label="取消时间"
            value={p.cancelled_at ? fmtDate(p.cancelled_at) : "—"}
          />
          <Field
            label="完成时间"
            value={p.completed_at ? fmtDate(p.completed_at) : "—"}
          />
          <Field label="需补位" value={p.needs_refill ? "是" : "否"} />
          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">标签</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {(p.tags ?? []).length === 0 ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                (p.tags ?? []).map((t) => (
                  <span
                    key={t}
                    className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {t}
                  </span>
                ))
              )}
            </div>
          </div>
          {p.content && (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">原文</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{p.content}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Moderation (editor+) — cancel/reopen via cancelled_at */}
      <SquadModeration
        postId={p.id}
        cancelled={p.cancelled_at !== null}
        statusLabel={squadStatusLabel(p.status)}
      />

      {/* Ping outcomes (aggregate only — never recipient identities) */}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">
            推送结果（{outcomes.total} 条）
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {outcomes.total === 0 ? (
            <p className="text-xs text-muted-foreground">这个局还没有推送记录</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="已发送" value={outcomes.sent} />
              <Stat label="被抑制" value={outcomes.suppressed} />
              <Stat label="已加入" value={outcomes.joined} tone="good" />
              <Stat label="已拒绝" value={outcomes.declined} tone="bad" />
              <Stat label="未回应" value={outcomes.noReply} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Joined members */}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-base">
            已加入成员（{members.length} 人）
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {members.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有人加入</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">成员</TableHead>
                    <TableHead className="w-24 px-4">来源</TableHead>
                    <TableHead className="w-28 px-4">RSVP</TableHead>
                    <TableHead className="w-40 px-4">加入时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="px-4 py-2">
                        {m.student_id
                          ? names.get(m.student_id) ?? m.student_id.slice(0, 8)
                          : m.user_id
                            ? `web · ${m.user_id.slice(0, 8)}`
                            : "—"}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                        {m.student_id ? "george" : "web"}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-xs">
                        {m.rsvp_status === "confirmed" ? (
                          <span className="text-emerald-700">已确认</span>
                        ) : (
                          <span className="text-muted-foreground">待确认</span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                        {fmtDate(m.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : "text-foreground";
  return (
    <div className="rounded-md border p-3 text-center">
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
