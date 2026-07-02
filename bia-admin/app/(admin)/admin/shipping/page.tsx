import Link from "next/link";
import {
  Boxes,
  ClipboardList,
  Contact,
  Package,
  PackagePlus,
  Route,
  ScanLine,
  Ship,
} from "lucide-react";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

const STAT_DEFS = [
  {
    key: "expected",
    label: "待入库",
    hint: "已登记、等待到仓",
    href: "/admin/shipping/parcels?status=expected",
  },
  {
    key: "received_cn",
    label: "待合单",
    hint: "已入库、等待编批",
    href: "/admin/shipping/parcels?status=received_cn",
  },
  {
    key: "in_transit",
    label: "运输中",
    hint: "已发车、在途",
    href: "/admin/shipping/parcels?status=in_transit",
  },
  {
    key: "arrived_us",
    label: "待取件",
    hint: "已到美国仓、等待核销",
    href: "/admin/shipping/parcels?status=arrived_us",
  },
] as const;

const QUICK_LINKS = [
  { href: "/admin/shipping/parcels", label: "包裹", icon: Package },
  { href: "/admin/shipping/parcels/intake", label: "入库", icon: PackagePlus },
  { href: "/admin/shipping/shipments", label: "批次", icon: Ship },
  { href: "/admin/shipping/pack-requests", label: "打包", icon: Boxes },
  { href: "/admin/shipping/requests", label: "发货", icon: ClipboardList },
  { href: "/admin/shipping/routes", label: "专线", icon: Route },
  { href: "/admin/shipping/contacts", label: "联系", icon: Contact },
  { href: "/admin/shipping/pickup", label: "核销", icon: ScanLine },
] as const;

export default async function ShippingOverviewPage() {
  await requireRole("viewer");
  const admin = createBiaServiceRoleClient();
  const head = { count: "exact" as const, head: true };

  const [counts, pendingPack, pendingRequests] = await Promise.all([
    Promise.all(
      STAT_DEFS.map((s) =>
        admin.from("parcels").select("id", head).eq("status", s.key),
      ),
    ),
    // Open work queues — these used to be invisible until someone happened to
    // open the page (SR-7).
    admin
      .from("pack_requests")
      .select("id", head)
      .in("status", ["pending", "contacted"]),
    admin
      .from("shipment_requests")
      .select("id", head)
      .in("status", ["pending", "contacted"]),
  ]);

  const QUEUE_DEFS = [
    {
      key: "pack",
      label: "打包申请待处理",
      hint: "pending / contacted 的打包申请",
      href: "/admin/shipping/pack-requests?status=pending",
      count: pendingPack.count ?? 0,
    },
    {
      key: "requests",
      label: "发货请求待处理",
      hint: "pending / contacted 的发货请求",
      href: "/admin/shipping/requests?status=pending",
      count: pendingRequests.count ?? 0,
    },
  ] as const;

  return (
    <div className="space-y-8 p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">集运 · 总览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          各阶段包裹数量与快捷入口。
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAT_DEFS.map((s, i) => (
          <Link
            key={s.key}
            href={s.href}
            className="group rounded-lg border bg-card p-5 transition-colors hover:border-primary"
          >
            <div className="text-sm font-medium text-foreground">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {counts[i].count ?? 0}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {QUEUE_DEFS.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className={`group rounded-lg border p-5 transition-colors hover:border-primary ${
              s.count > 0 ? "border-amber-300 bg-amber-50" : "bg-card"
            }`}
          >
            <div className="text-sm font-medium text-foreground">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {s.count}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          快捷入口
        </h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
