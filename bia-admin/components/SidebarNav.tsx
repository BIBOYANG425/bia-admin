"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { roleAtLeast, type Role } from "@biboyang425/bia-shared";
import { cn } from "@/lib/utils";
import {
  ADMIN_SECTIONS,
  ADMIN_GROUPS,
  type AdminSection,
  type AdminGroup,
} from "@/lib/admin/sections";

export default function SidebarNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const grouped: Record<AdminGroup, AdminSection[]> = {
    content: [],
    community: [],
    operations: [],
    people: [],
    system: [],
  };
  // Hide sections the current role can't even view (write-only pages). Most
  // sections default to "viewer" (everyone); per-control write-gating inside a
  // page is handled by each surface.
  for (const s of ADMIN_SECTIONS) {
    if (s.minRole && !roleAtLeast(role, s.minRole)) continue;
    grouped[s.group].push(s);
  }

  return (
    <nav className="flex-1 space-y-6">
      {(Object.keys(grouped) as AdminGroup[]).map((g) => {
        if (grouped[g].length === 0) return null;
        return (
          <div key={g}>
            <p className="px-2 mb-1 text-[10px] font-semibold tracking-[0.12em] uppercase text-zinc-500">
              {ADMIN_GROUPS[g]}
            </p>
            <ul className="space-y-px">
              {grouped[g].map((s) => {
                const active =
                  pathname === s.href || pathname.startsWith(s.href + "/");
                const Icon = s.icon;
                if (!s.enabled) {
                  return (
                    <li key={s.href}>
                      <span
                        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-zinc-600 cursor-not-allowed"
                        title={`Coming in ${s.comingIn}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{s.label}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-600">
                          soon
                        </span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors",
                        active
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{s.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
