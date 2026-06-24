import {
  Boxes,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Contact,
  MessageSquare,
  Newspaper,
  Package,
  PackagePlus,
  Route,
  ScanLine,
  ScrollText,
  Ship,
  Star,
  UserRound,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@biboyang425/bia-shared";

export type AdminGroup =
  | "content"
  | "community"
  | "operations"
  | "people"
  | "system";

export interface AdminSection {
  href: string;
  label: string;
  icon: LucideIcon;
  group: AdminGroup;
  /** Disabled sections render greyed out with a tooltip "Coming in Phase X". */
  enabled: boolean;
  comingIn?: string;
  /**
   * Minimum role required to even SEE this section in the nav. Defaults to
   * "viewer" (everyone). Set to "editor" for write-only pages (no read value
   * for a viewer) so viewers aren't shown a flow they can't complete.
   */
  minRole?: Role;
}

export const ADMIN_GROUPS: Record<AdminGroup, string> = {
  content: "Content",
  community: "Community",
  operations: "Operations",
  people: "People",
  system: "System",
};

export const ADMIN_SECTIONS: AdminSection[] = [
  // Phase 1 — enabled
  { href: "/admin/members", label: "Members", icon: Users, group: "people", enabled: true },
  // Phase 3 slice 3a — 用户 (students, migrated from roommate /admin/users; read-only)
  { href: "/admin/users",   label: "用户",     icon: UserRound, group: "people", enabled: true },

  // Phase 2 — disabled placeholders
  { href: "/admin/blog",     label: "Blog",     icon: Newspaper, group: "content",   enabled: true },
  { href: "/admin/comments", label: "评论管理", icon: MessageSquare, group: "content", enabled: true },
  { href: "/admin/events",      label: "活动",     icon: Calendar,       group: "content",   enabled: true },
  { href: "/admin/marketplace", label: "活动投稿", icon: ClipboardCheck, group: "content",   enabled: true },
  { href: "/admin/sponsors", label: "Sponsors", icon: Star,      group: "content",   enabled: true },
  { href: "/admin/squad",    label: "Squad",    icon: Users2,    group: "community", enabled: true },

  // Phase 3 — 集运 (live: parity-checked + prod smoke passed 2026-06-05, slice 9)
  { href: "/admin/shipping/parcels",        label: "集运·包裹", icon: Package,      group: "operations", enabled: true },
  { href: "/admin/shipping/parcels/intake", label: "集运·入库", icon: PackagePlus,  group: "operations", enabled: true, minRole: "editor" },
  { href: "/admin/shipping/shipments",      label: "集运·批次", icon: Ship,         group: "operations", enabled: true },
  { href: "/admin/shipping/pack-requests", label: "集运·打包", icon: Boxes,         group: "operations", enabled: true },
  { href: "/admin/shipping/requests",      label: "集运·发货", icon: ClipboardList, group: "operations", enabled: true },
  { href: "/admin/shipping/routes",        label: "集运·专线", icon: Route,         group: "operations", enabled: true },
  { href: "/admin/shipping/contacts",      label: "集运·联系", icon: Contact,       group: "operations", enabled: true },
  { href: "/admin/shipping/pickup",        label: "集运·核销", icon: ScanLine,      group: "operations", enabled: true, minRole: "editor" },

  // System — audit log viewer over admin_audit_log (WS0).
  { href: "/admin/audit", label: "审计日志", icon: ScrollText, group: "system", enabled: true },
];
