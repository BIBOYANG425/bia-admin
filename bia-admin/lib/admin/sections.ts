import {
  Calendar,
  Newspaper,
  Package,
  Star,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";

export type AdminGroup = "content" | "community" | "operations" | "people";

export interface AdminSection {
  href: string;
  label: string;
  icon: LucideIcon;
  group: AdminGroup;
  /** Disabled sections render greyed out with a tooltip "Coming in Phase X". */
  enabled: boolean;
  comingIn?: string;
}

export const ADMIN_GROUPS: Record<AdminGroup, string> = {
  content: "Content",
  community: "Community",
  operations: "Operations",
  people: "People",
};

export const ADMIN_SECTIONS: AdminSection[] = [
  // Phase 1 — enabled
  { href: "/admin/members", label: "Members", icon: Users, group: "people", enabled: true },

  // Phase 2 — disabled placeholders
  { href: "/admin/blog",     label: "Blog",     icon: Newspaper, group: "content",   enabled: true },
  { href: "/admin/events",   label: "Events",   icon: Calendar,  group: "content",   enabled: false, comingIn: "Phase 2" },
  { href: "/admin/sponsors", label: "Sponsors", icon: Star,      group: "content",   enabled: false, comingIn: "Phase 2" },
  { href: "/admin/squad",    label: "Squad",    icon: Users2,    group: "community", enabled: false, comingIn: "Phase 2" },

  // Phase 3 — disabled placeholder
  { href: "/admin/shipping/parcels", label: "集运", icon: Package, group: "operations", enabled: false, comingIn: "Phase 3" },
];
