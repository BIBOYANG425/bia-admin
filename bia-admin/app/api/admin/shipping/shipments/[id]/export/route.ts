// /api/admin/shipping/shipments/[id]/export
// GET — stream a shipment's parcels as a CSV manifest / 取件清单 (viewer+).
// Includes the payment-reconciliation columns (live since migration
// 20260620000005) so the exported sheet doubles as the collection sheet the
// roster is for. Exporting member payment data leaves the audit trail even
// though it's read-only (SR-5).

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import {
  PARCEL_STATUS_META,
  SHIPPING_METHOD_META,
  type Parcel,
  type ParcelStatus,
  type ShippingMethod,
} from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";
import { writeAudit } from "@/lib/admin/audit-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Escape one CSV cell: wrap in quotes, double internal quotes, and neutralize
// spreadsheet formula-injection by prefixing a leading = + - @ with a quote —
// including when hidden behind leading whitespace/control chars, which Excel
// strips before evaluating (SR-8).
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(_request: Request, ctx: RouteContext) {
  return withRole("viewer", async (auth) => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const [{ data: shipment, error: sErr }, { data: parcels, error: pErr }] =
      await Promise.all([
        admin.from("shipments").select("id, name").eq("id", id).maybeSingle(),
        admin
          .from("parcels")
          .select(
            "member_id, description, status, weight_grams, shipping_method, tracking_cn, created_at, amount_owed_cents, paid_at, paid_method, paid_by_admin",
          )
          .eq("shipment_id", id)
          .order("member_id", { ascending: true }),
      ]);

    if (sErr || pErr) {
      return NextResponse.json(
        { error: "lookup_failed", details: (sErr ?? pErr)!.message },
        { status: 500 },
      );
    }
    if (!shipment) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const PAID_METHOD_LABEL: Record<string, string> = {
      cash: "现金",
      transfer: "转账",
      other: "其他",
    };

    const header = [
      "Member ID",
      "描述",
      "状态",
      "重量(g)",
      "重量(kg)",
      "运输方式",
      "国内单号",
      "创建时间",
      "应收(¥)",
      "已付",
      "支付方式",
      "收款人",
      "付款时间",
    ];

    const rows = ((parcels ?? []) as Array<
      Pick<
        Parcel,
        | "member_id"
        | "description"
        | "status"
        | "weight_grams"
        | "shipping_method"
        | "tracking_cn"
        | "created_at"
        | "amount_owed_cents"
        | "paid_at"
        | "paid_method"
        | "paid_by_admin"
      >
    >).map((p) => [
      p.member_id,
      p.description,
      PARCEL_STATUS_META[p.status as ParcelStatus]?.label ?? p.status,
      p.weight_grams ?? "",
      p.weight_grams != null ? (p.weight_grams / 1000).toFixed(2) : "",
      p.shipping_method
        ? (SHIPPING_METHOD_META[p.shipping_method as ShippingMethod]?.label ??
          p.shipping_method)
        : "",
      p.tracking_cn ?? "",
      p.created_at,
      p.amount_owed_cents != null
        ? (p.amount_owed_cents / 100).toFixed(2)
        : "",
      p.paid_at ? "是" : "",
      p.paid_method ? (PAID_METHOD_LABEL[p.paid_method] ?? p.paid_method) : "",
      p.paid_by_admin ?? "",
      p.paid_at ?? "",
    ]);

    // Leading BOM so Excel detects UTF-8 and renders Chinese correctly.
    const BOM = String.fromCharCode(0xfeff);
    const csv =
      BOM + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

    await writeAudit({
      admin_email: auth.user.email,
      action: "shipment.export",
      entity_type: "shipment",
      entity_id: id,
      payload: { rows: rows.length },
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="manifest-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
