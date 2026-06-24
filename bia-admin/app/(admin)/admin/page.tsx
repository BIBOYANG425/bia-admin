import Link from "next/link";
import {
  Calendar,
  ClipboardCheck,
  Inbox,
  Mail,
  Newspaper,
  PackagePlus,
  ScanLine,
} from "lucide-react";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { requireRole } from "@/lib/auth/require-role";
import {
  MARKETPLACE_WEEKLY_CAP,
  countApprovedSubmissionsThisWeek,
} from "@/lib/marketplace/cap-enforcement";

export const dynamic = "force-dynamic";

interface Tile {
  href: string;
  label: string;
  count: number;
  hint: string;
  icon: typeof Inbox;
  /** Tile is only worth surfacing as "needs you" when count > 0. */
  urgent: boolean;
}

export default async function AdminHomePage() {
  const { user, role } = await requireRole("viewer");
  const admin = createBiaServiceRoleClient();
  const head = { count: "exact" as const, head: true };

  const [
    invites,
    expected,
    arrived,
    submissions,
    approvedThisWeek,
    inReview,
  ] = await Promise.all([
    admin.from("admin_invitations").select("id", head).is("accepted_at", null),
    admin.from("parcels").select("id", head).eq("status", "expected"),
    admin.from("parcels").select("id", head).eq("status", "arrived_us"),
    admin.from("event_submissions").select("id", head).eq("status", "pending"),
    countApprovedSubmissionsThisWeek(admin),
    admin.from("articles").select("id", head).eq("status", "in_review"),
  ]);

  const pendingInvites = invites.count ?? 0;
  const parcelsExpected = expected.count ?? 0;
  const parcelsArrived = arrived.count ?? 0;
  const submissionsPending = submissions.count ?? 0;
  const articlesInReview = inReview.count ?? 0;

  const tiles: Tile[] = [
    {
      href: "/admin/members",
      label: "待接受邀请",
      count: pendingInvites,
      hint: "已发出、尚未接受的 officer 邀请",
      icon: Mail,
      urgent: pendingInvites > 0,
    },
    {
      href: "/admin/shipping/parcels?status=expected",
      label: "待入库包裹",
      count: parcelsExpected,
      hint: "已登记、等待到仓的包裹",
      icon: PackagePlus,
      urgent: parcelsExpected > 0,
    },
    {
      href: "/admin/shipping/parcels?status=arrived_us",
      label: "待取件包裹",
      count: parcelsArrived,
      hint: "已到美国仓、等待核销取件",
      icon: ScanLine,
      urgent: parcelsArrived > 0,
    },
    {
      href: "/admin/marketplace",
      label: "待审核投稿",
      count: submissionsPending,
      hint: `本周已通过 ${approvedThisWeek} / ${MARKETPLACE_WEEKLY_CAP}`,
      icon: ClipboardCheck,
      urgent: submissionsPending > 0,
    },
    {
      href: "/admin/blog?status=in_review",
      label: "待审文章",
      count: articlesInReview,
      hint: "提交审核、等待发布的草稿",
      icon: Newspaper,
      urgent: articlesInReview > 0,
    },
  ];

  const urgent = tiles.filter((t) => t.urgent);
  const quiet = tiles.filter((t) => !t.urgent);

  return (
    <div className="p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user.email.split("@")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {urgent.length > 0
            ? `有 ${urgent.length} 类事项需要你处理。`
            : "暂时没有待处理事项，一切就绪。"}
          {role === "viewer" ? "（只读）" : ""}
        </p>
      </header>

      {urgent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            需要你处理
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {urgent.map((t) => (
              <TileCard key={t.href} tile={t} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {urgent.length > 0 ? "其它队列" : "所有队列"}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(urgent.length > 0 ? quiet : tiles).map((t) => (
            <TileCard key={t.href} tile={t} />
          ))}
        </div>
      </section>

      <section className="flex flex-wrap gap-2 pt-2">
        <QuickLink href="/admin/events" icon={Calendar} label="活动" />
        <QuickLink href="/admin/shipping/shipments" icon={Inbox} label="集运·批次" />
        <QuickLink href="/admin/users" icon={Inbox} label="用户" />
      </section>
    </div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <Link
      href={tile.href}
      className="group rounded-lg border bg-card p-5 transition-colors hover:border-primary"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          <span className="text-sm font-medium text-foreground">
            {tile.label}
          </span>
        </div>
        <span
          className={
            tile.urgent
              ? "rounded-full bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary"
              : "text-sm font-semibold text-muted-foreground"
          }
        >
          {tile.count}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{tile.hint}</p>
    </Link>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Inbox;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}
