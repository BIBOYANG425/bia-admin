// Admin user detail — async server component. Queries the student row, email
// (auth.users), parcels, and course_reviews directly (formerly via the deleted
// single-consumer GET /api/admin/users/[id]); a small UserDetailTabs client
// island toggles the parcels/reviews panes. Read-only; parcel rows deep-link
// into /admin/shipping/parcels/[id]. Date output stays en-US (matches the
// users list) — see lib/format.ts note on intentional locale exceptions.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
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
import { requireRole } from "@/lib/auth/require-role";
import { UserDetailTabs } from "./UserDetailTabs";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

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

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  await requireRole("viewer");
  const { id } = await params;
  const admin = createBiaServiceRoleClient();

  const { data: studentRow, error } = await admin
    .from("students")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load user: ${error.message}`);
  }
  if (!studentRow) notFound();
  const student = studentRow as Student;

  let email: string | null = null;
  if (student.user_id) {
    const { data: authUser } = await admin.auth.admin.getUserById(
      student.user_id,
    );
    email = authUser.user?.email ?? null;
  }

  const parcelsRes = student.user_id
    ? await admin
        .from("parcels")
        .select("*")
        .eq("user_id", student.user_id)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  // course_reviews may not be deployed to this DB; catch missing-table softly.
  const reviewsRes = student.user_id
    ? await admin
        .from("course_reviews")
        .select("*")
        .eq("user_id", student.user_id)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  const parcels = (parcelsRes.data ?? []) as Parcel[];
  const parcelsByStatus = {} as Record<ParcelStatus, number>;
  for (const p of parcels) {
    parcelsByStatus[p.status] = (parcelsByStatus[p.status] ?? 0) + 1;
  }

  const reviews = (
    reviewsRes.error ? null : reviewsRes.data ?? []
  ) as Review[] | null;
  const reviewsUnavailable =
    reviewsRes.error?.message?.includes("does not exist") ?? false;

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

      <UserDetailTabs
        parcelsCount={parcelsTotal}
        reviewsUnavailable={reviewsUnavailable}
        reviewsCount={reviewsCount}
        parcelsPane={
          <ParcelsPane parcels={parcels} parcelsByStatus={parcelsByStatus} />
        }
        reviewsPane={
          <ReviewsPane
            reviews={reviews}
            reviewsUnavailable={reviewsUnavailable}
          />
        }
      />
    </div>
  );
}

function ParcelsPane({
  parcels,
  parcelsByStatus,
}: {
  parcels: Parcel[];
  parcelsByStatus: Record<ParcelStatus, number>;
}) {
  if (parcels.length === 0) {
    return <p className="text-sm text-muted-foreground">这个用户还没有包裹</p>;
  }
  return (
    <div className="space-y-4">
      {/* Status breakdown */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
        {(Object.keys(parcelsByStatus) as ParcelStatus[]).map((s) =>
          parcelsByStatus[s] > 0 ? (
            <span key={s}>
              <span className="font-medium">{PARCEL_STATUS_META[s].label}</span>
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
  );
}

function ReviewsPane({
  reviews,
  reviewsUnavailable,
}: {
  reviews: Review[] | null;
  reviewsUnavailable: boolean;
}) {
  if (reviewsUnavailable) {
    return (
      <p className="text-sm text-muted-foreground">
        course_reviews 表还未部署到这个库。运行 course_rating migration
        后此处会自动显示。
      </p>
    );
  }
  if ((reviews?.length ?? 0) === 0) {
    return (
      <p className="text-sm text-muted-foreground">这个用户还没有发过课评</p>
    );
  }
  return (
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
  );
}
