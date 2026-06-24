"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { Role } from "@biboyang425/bia-shared";
import { ADMIN_SECTIONS, ADMIN_GROUPS } from "@/lib/admin/sections";
import MobileNav from "@/components/MobileNav";

/**
 * Thin top bar across the content area: mobile hamburger (md:hidden),
 * breadcrumbs derived from ADMIN_SECTIONS + the current route, and a role chip.
 */
export default function TopBar({ role, email }: { role: Role; email: string }) {
  const pathname = usePathname();

  // Longest-prefix match against the nav so deep routes still resolve a crumb.
  const section = ADMIN_SECTIONS.filter(
    (s) => pathname === s.href || pathname.startsWith(s.href + "/"),
  ).sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-white/80 px-4 backdrop-blur">
      <MobileNav role={role} email={email} />

      <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1 text-sm">
        <Link
          href="/admin"
          className="text-muted-foreground hover:text-foreground"
        >
          首页
        </Link>
        {section ? (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {ADMIN_GROUPS[section.group]}
            </span>
            <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/60 sm:inline" />
            <span className="truncate font-medium text-foreground">
              {section.label}
            </span>
          </>
        ) : null}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {role === "viewer" ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Viewer · 只读
          </span>
        ) : (
          <span className="hidden text-xs capitalize text-muted-foreground sm:inline">
            {role.replace("_", " ")}
          </span>
        )}
      </div>
    </header>
  );
}
