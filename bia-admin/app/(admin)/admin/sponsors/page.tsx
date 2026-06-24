import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";

import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/require-role";
import { SponsorsTable, type SponsorRow } from "./SponsorsTable";

export const dynamic = "force-dynamic";

const TIERS = ["event", "recruiting", "local_service", "payment"] as const;
const TIER_SET = new Set<string>(TIERS);

interface PageProps {
  searchParams: Promise<{ tier?: string; active?: string }>;
}

export default async function AdminSponsorsPage({ searchParams }: PageProps) {
  await requireRole("viewer");
  const sp = await searchParams;
  const tier = sp.tier && TIER_SET.has(sp.tier) ? sp.tier : "";
  const active =
    sp.active === "true" ? "true" : sp.active === "false" ? "false" : "";

  const admin = createBiaServiceRoleClient();
  let query = admin
    .from("sponsors")
    .select("*", { count: "exact" })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (tier) query = query.eq("tier", tier);
  if (active === "true") query = query.eq("active", true);
  else if (active === "false") query = query.eq("active", false);

  const { data, count, error } = await query.limit(500);
  if (error) {
    throw new Error(`Failed to load sponsors: ${error.message}`);
  }

  const rows = (data ?? []) as SponsorRow[];
  const total = count ?? 0;

  return (
    <div className="space-y-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Sponsors</h1>
        <p className="text-sm text-muted-foreground">
          {total} 个赞助方 · 活动 / 招聘 / 本地服务 / 支付伙伴
        </p>
      </header>

      <form
        method="get"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="tier" className="text-xs text-muted-foreground">
            分类
          </label>
          <select
            id="tier"
            name="tier"
            defaultValue={tier}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm sm:w-44"
          >
            <option value="">全部分类</option>
            <option value="event">活动 Event</option>
            <option value="recruiting">招聘 Recruiting</option>
            <option value="local_service">本地服务 Local service</option>
            <option value="payment">支付 Payment</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="active" className="text-xs text-muted-foreground">
            状态
          </label>
          <select
            id="active"
            name="active"
            defaultValue={active}
            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm sm:w-36"
          >
            <option value="">全部状态</option>
            <option value="true">启用</option>
            <option value="false">已下线</option>
          </select>
        </div>
        <Button type="submit">筛选</Button>
      </form>

      <SponsorsTable rows={rows} />
    </div>
  );
}
