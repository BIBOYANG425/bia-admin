"use client";

// Admin user detail — student header + tabs for parcels and course reviews.
// Read-only; parcel rows deep-link into /admin/shipping/parcels/[id].
// Ported from bia-roommate (Phase-3 slice 3a · users migration), restyled to shadcn.

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  PARCEL_STATUS_META,
  SHIPPING_METHOD_META,
  type Parcel,
  type ParcelStatus,
} from "@biboyang425/bia-shared/shipping";

import { ParcelStatusPill } from "@/components/shipping/ParcelStatusPill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Student {
  id: string;
  name: string | null;
  member_id: string | null;
  user_id: string | null;
  major: string | null;
  year: string | null;
  created_at: string;
}

interface Review {
  id: string;
  dept: string;
  course_number: string;
  professor: string | null;
  term: string;
  difficulty: number;
  workload: number;
  grading: number;
  comment: string;
  created_at: string;
}

interface UserDetail {
  student: Student;
  email: string | null;
  parcels: Parcel[];
  parcelsByStatus: Record<ParcelStatus, number>;
  reviews: Review[] | null;
  reviewsUnavailable: boolean;
}

type Tab = "parcels" | "reviews";

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("parcels");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/users/${id}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "用户不存在" : "加载失败");
          return;
        }
        setData((await res.json()) as UserDetail);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">加载中...</div>;
  }
  if (error || !data) {
    return <div className="p-8 text-sm text-rose-600">{error ?? "未找到"}</div>;
  }

  const { student, email, parcels, parcelsByStatus, reviews, reviewsUnavailable } =
    data;
  const parcelsTotal = parcels.length;
  const reviewsCount = reviews?.length ?? 0;

  return (
    <div className="p-8 space-y-6">
      <Link
        href="/admin/users"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← 用户
      </Link>

      {/* Header card */}
      <section className="rounded-lg border bg-muted/30 p-5">
        <h1 className="text-2xl font-bold leading-tight">
          {student.name ?? "(未设置名字)"}
        </h1>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {student.member_id && (
            <span className="font-mono">{student.member_id}</span>
          )}
          {email && <span>{email}</span>}
          {student.major && <span>{student.major}</span>}
          {student.year && <span>{student.year}</span>}
          <span>· 注册 {fmtDate(student.created_at)}</span>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-2">
        <TabButton active={tab === "parcels"} onClick={() => setTab("parcels")}>
          包裹 · {parcelsTotal}
        </TabButton>
        <TabButton active={tab === "reviews"} onClick={() => setTab("reviews")}>
          课评 · {reviewsUnavailable ? "—" : reviewsCount}
        </TabButton>
      </div>

      {tab === "parcels" &&
        (parcelsTotal === 0 ? (
          <p className="text-sm text-muted-foreground">这个用户还没有包裹</p>
        ) : (
          <div className="space-y-4">
            {/* Status breakdown */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
              {(Object.keys(parcelsByStatus) as ParcelStatus[]).map((s) =>
                parcelsByStatus[s] > 0 ? (
                  <span key={s}>
                    <span className="font-medium">
                      {PARCEL_STATUS_META[s].label}
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      {parcelsByStatus[s]}
                    </span>
                  </span>
                ) : null,
              )}
            </div>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">Member</TableHead>
                    <TableHead className="px-4">Description</TableHead>
                    <TableHead className="w-32 px-4">Status</TableHead>
                    <TableHead className="w-24 px-4">方式</TableHead>
                    <TableHead className="w-32 px-4">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parcels.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="px-4 py-3">
                        <Link
                          href={`/admin/shipping/parcels/${p.id}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {p.member_id}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate px-4 py-3">
                        {p.description}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <ParcelStatusPill status={p.status} size="sm" />
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs">
                        {p.shipping_method
                          ? SHIPPING_METHOD_META[p.shipping_method].icon
                          : "—"}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                        {fmtDate(p.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}

      {tab === "reviews" &&
        (reviewsUnavailable ? (
          <p className="text-sm text-muted-foreground">
            course_reviews 表还未部署到这个库。运行 course_rating migration
            后此处会自动显示。
          </p>
        ) : reviewsCount === 0 ? (
          <p className="text-sm text-muted-foreground">这个用户还没有发过课评</p>
        ) : (
          <div className="space-y-3">
            {reviews!.map((r) => (
              <div key={r.id} className="rounded-lg border bg-muted/30 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold">
                    {r.dept} {r.course_number}
                    {r.professor && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · {r.professor}
                      </span>
                    )}
                  </h3>
                  <span className="text-[10px] text-muted-foreground">
                    {r.term} · {fmtDate(r.created_at)}
                  </span>
                </div>
                <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
                  <span>难度 {r.difficulty}/5</span>
                  <span>工作量 {r.workload}/5</span>
                  <span>给分 {r.grading}/5</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{r.comment}</p>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-transparent text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
