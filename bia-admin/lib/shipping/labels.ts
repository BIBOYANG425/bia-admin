// Shared shipping UI labels + API-error → officer-facing message mapping.
// The shipment status labels used to live inside the shipment detail page, so
// every other surface (list, pickers) rendered raw English enum values (SR-7).

import type { ShipmentStatus } from "@biboyang425/bia-shared/shipping";

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  forming: "组建中",
  sealed: "已封箱",
  departed_cn: "国内发出",
  customs: "清关中",
  arrived_us: "到达美国",
  pickup_open: "可取件",
  pickup_closed: "已关闭",
  archived: "已归档",
};

export function shipmentStatusLabel(status: string): string {
  return SHIPMENT_STATUS_LABELS[status as ShipmentStatus] ?? status;
}

// Officer-facing copy for the machine error codes the shipping APIs return.
// Codes without an entry fall back to the raw code (better than nothing, and
// it keeps this map honest about what officers actually see).
const ERROR_MESSAGES: Record<string, string> = {
  invalid_body: "输入无效，请检查后重试",
  invalid_status: "状态无效",
  invalid_transition: "状态流转不允许（不能跳回更早的状态）",
  invalid_pagination: "分页参数无效",
  no_fields: "没有可保存的修改",
  not_found: "未找到该记录",
  shipment_not_found: "批次不存在",
  no_parcels: "该申请没有关联包裹",
  shipment_not_attachable: "批次已发出/归档，不能再附加包裹",
  shipment_not_detachable: "批次已发出/归档，包裹不能移出",
  request_not_attachable: "申请已处理，不能重复附加",
  shipment_has_active_parcels: "还有包裹未完成（未取件/丢失/退回），不能归档",
  parcel_terminal: "包裹已是最终状态",
  already_picked_up: "该包裹已核销",
  shipment_id_not_patchable: "请通过「批次 → 关联包裹」操作，而不是直接改字段",
  reason_required: "请填写原因",
  member_id_required: "请填写 Member ID",
  list_failed: "加载失败，请重试",
  lookup_failed: "查询失败，请重试",
  update_failed: "保存失败，请重试",
  create_failed: "创建失败，请重试",
  attach_failed: "附加失败，请重试",
  detach_failed: "移出失败，请重试",
  receive_failed: "入库失败，请重试",
  revert_failed: "撤销失败，请重试",
  reassign_failed: "重新指派失败，请重试",
  upload_failed: "上传失败，请重试",
  too_large: "文件过大（上限 2MB）",
  bad_type: "只支持 PNG / JPEG / WebP 图片",
  no_file: "请选择文件",
};

/**
 * Pick the best officer-facing message out of an API error body:
 * server-provided Chinese `message`/`detail` wins, then the code map,
 * then the raw code, then the caller's fallback.
 */
export function errText(
  data: { message?: string; detail?: string; error?: string } | null | undefined,
  fallback: string,
): string {
  if (!data) return fallback;
  if (data.message) return data.message;
  if (data.detail) return data.detail;
  if (data.error) return ERROR_MESSAGES[data.error] ?? data.error;
  return fallback;
}
