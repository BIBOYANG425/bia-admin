/* ── Shipping / 集运 shared types ──────────────────────────────────────────
 * Single source of truth for the consolidated-shipping domain, shared between
 * uscbia.com (bia-roommate) and admin.uscbia.com (bia-admin). Pure type/data
 * only — no runtime deps, no side effects. Tables: public.parcels,
 * public.shipments, public.shipping_routes, public.pack_requests, etc.
 * Ported verbatim from bia-roommate/lib/types.ts (Phase-3 migration, slice 1).
 * ────────────────────────────────────────────────────────────────────────── */

export const SHIPPING_METHOD_VALUES = ["sea", "air", "sensitive"] as const;
export type ShippingMethod = (typeof SHIPPING_METHOD_VALUES)[number];

// Display order for UI surfaces (ScheduleCard, admin list). DB rows may come
// back in a different order; consumers that care about ordering should sort
// by this.
export const SHIPPING_METHOD_ORDER: Record<ShippingMethod, number> = {
  sea: 0,
  air: 1,
  sensitive: 2,
};

export const SHIPPING_METHOD_META: Record<
  ShippingMethod,
  { label: string; labelEn: string; icon: string }
> = {
  sea: { label: "海运专线", labelEn: "Sea Freight", icon: "🚢" },
  air: { label: "空运急件", labelEn: "Air Freight", icon: "✈️" },
  sensitive: {
    label: "敏感货专线",
    labelEn: "Sensitive Freight",
    icon: "⚡",
  },
};

export interface ShippingRoute {
  id: string;
  method: ShippingMethod;
  label: string;
  price_per_kg_cny: number | null;
  next_departure_date: string | null;
  estimated_arrival_date: string | null;
  transit_days_estimate: number | null;
  cutoff_note: string | null;
  notes: string | null;
  /** Human-readable cadence shown under the countdown (e.g. "每周发车"). */
  frequency_label: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const SHIPMENT_REQUEST_STATUS_VALUES = [
  "pending",
  "contacted",
  "scheduled",
  "declined",
  "completed",
] as const;
export type ShipmentRequestStatus =
  (typeof SHIPMENT_REQUEST_STATUS_VALUES)[number];

export const SHIPMENT_REQUEST_STATUS_LABELS: Record<
  ShipmentRequestStatus,
  string
> = {
  pending: "待处理",
  contacted: "已联系",
  scheduled: "已排期",
  declined: "已拒绝",
  completed: "已完成",
};

/** Public history entry for /api/shipping/history — one row per closed batch. */
export interface ShipmentHistoryEntry {
  id: string;
  name: string;
  status: ShipmentStatus;
  departed_cn_at: string | null;
  arrived_us_at: string | null;
  carrier: string | null;
  total_weight_grams: number;
  parcel_count: number;
  /** Rounded days between departed_cn_at and arrived_us_at, null if either is missing. */
  transit_days: number | null;
  /** Most-common shipping_method across the batch's parcels; null if none are tagged. */
  dominant_method: ShippingMethod | null;
}

/* ── Pack Requests (user-initiated consolidation) ── */

export const PACK_REQUEST_STATUS_VALUES = [
  "pending",
  "contacted",
  "approved",
  "packed",
  "shipped",
  "declined",
  "cancelled",
] as const;
export type PackRequestStatus = (typeof PACK_REQUEST_STATUS_VALUES)[number];

export const PACK_REQUEST_STATUS_LABELS: Record<PackRequestStatus, string> = {
  pending: "待处理",
  contacted: "已联系",
  approved: "已排入批次",
  packed: "已打包",
  shipped: "已发出",
  declined: "已拒绝",
  cancelled: "已取消",
};

export interface PackRequest {
  id: string;
  user_id: string | null;
  student_id: string | null;
  member_id: string | null;
  preferred_method: ShippingMethod | null;
  urgency_note: string | null;
  contact: string | null;
  user_note: string | null;
  status: PackRequestStatus;
  admin_note: string | null;
  shipment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackRequestWithParcels extends PackRequest {
  parcels: Pick<
    Parcel,
    | "id"
    | "member_id"
    | "description"
    | "status"
    | "shipping_method"
    | "weight_grams"
    | "photos"
  >[];
}

export interface ShipmentRequest {
  id: string;
  user_id: string | null;
  student_id: string | null;
  member_id: string | null;
  description: string;
  expected_weight_grams: number | null;
  preferred_method: ShippingMethod | null;
  urgency_note: string | null;
  contact: string | null;
  status: ShipmentRequestStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

export const SHIPPING_CONTACT_TYPES = [
  "wechat_group",
  "wechat_personal",
  "email",
  "george_bot",
] as const;
export type ShippingContactType = (typeof SHIPPING_CONTACT_TYPES)[number];

export interface ShippingContact {
  id: string;
  type: ShippingContactType;
  value: string;
  label: string;
  label_en: string | null;
  qr_code_url: string | null;
  display_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const PARCEL_STATUS_VALUES = [
  "expected",
  "received_cn",
  "in_transit",
  "arrived_us",
  "picked_up",
  "lost",
  "returned",
  "disputed",
] as const;
export type ParcelStatus = (typeof PARCEL_STATUS_VALUES)[number];

export const SHIPMENT_STATUS_VALUES = [
  "forming",
  "sealed",
  "departed_cn",
  "customs",
  "arrived_us",
  "pickup_open",
  "pickup_closed",
  "archived",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS_VALUES)[number];

export const PARCEL_CATEGORY_OPTIONS = [
  "电子产品",
  "服饰",
  "食品",
  "日用品",
  "书籍",
  "其它",
] as const;
export type ParcelCategory = (typeof PARCEL_CATEGORY_OPTIONS)[number];

export const CN_CARRIER_OPTIONS = [
  "顺丰",
  "中通",
  "圆通",
  "韵达",
  "申通",
  "京东",
  "EMS",
  "其它",
] as const;

export interface Parcel {
  id: string;
  user_id: string | null;
  student_id: string | null;
  member_id: string;
  tracking_cn: string | null;
  carrier_cn: string | null;
  description: string;
  declared_value_cny: number | null;
  category: string | null;
  photos: string[];
  status: ParcelStatus;
  warehouse_id: string | null;
  shipment_id: string | null;
  received_at: string | null;
  weight_grams: number | null;
  dim_cm_l: number | null;
  dim_cm_w: number | null;
  dim_cm_h: number | null;
  notes: string | null;
  user_notes: string | null;
  shipping_method: ShippingMethod | null;
  /** Per-parcel pickup code (QR + short code) for officer 核销. */
  pickup_token?: string | null;
  /** Offline payment reconciliation (officer bookkeeping). Amounts in cents. */
  amount_owed_cents?: number | null;
  paid_at?: string | null;
  paid_by_admin?: string | null;
  paid_method?: "cash" | "transfer" | "other" | null;
  paid_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParcelEvent {
  id: string;
  parcel_id: string;
  from_status: ParcelStatus | null;
  to_status: ParcelStatus;
  actor_user_id: string | null;
  actor_role: "user" | "admin" | "system" | null;
  note: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface Shipment {
  id: string;
  name: string;
  status: ShipmentStatus;
  carrier: string | null;
  international_tracking: string | null;
  departed_cn_at: string | null;
  arrived_us_at: string | null;
  pickup_location: string | null;
  pickup_starts_at: string | null;
  pickup_ends_at: string | null;
  price_per_kg_cents: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WarehouseAddress {
  id: string;
  code: string;
  display_name: string;
  recipient_template: string;
  street: string;
  city: string;
  province: string;
  postal_code: string;
  phone: string;
  active: boolean;
  notes: string | null;
}

/** Human-facing Chinese labels + styling intent per parcel status. */
export const PARCEL_STATUS_META: Record<
  ParcelStatus,
  { label: string; hint: string; tone: "pending" | "active" | "good" | "bad" }
> = {
  expected: {
    label: "待入库",
    hint: "仓库还没收到，发货后记得填跟踪号",
    tone: "pending",
  },
  received_cn: {
    label: "仓库签收",
    hint: "已签收并上架，等下一批国际段",
    tone: "active",
  },
  in_transit: {
    label: "国际段运输",
    hint: "正在飞往美国，一般 7-14 天",
    tone: "active",
  },
  arrived_us: {
    label: "到达美国",
    hint: "到了，等 BIA 安排取件",
    tone: "active",
  },
  picked_up: {
    label: "已取件",
    hint: "完成",
    tone: "good",
  },
  lost: {
    label: "丢失",
    hint: "联系 BIA 运营，我们跟进理赔",
    tone: "bad",
  },
  returned: {
    label: "退回",
    hint: "包裹被退回，查看备注",
    tone: "bad",
  },
  disputed: {
    label: "待核实",
    hint: "有问题需要沟通，BIA 会联系你",
    tone: "bad",
  },
};
