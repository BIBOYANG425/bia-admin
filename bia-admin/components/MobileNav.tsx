"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { Role } from "@biboyang425/bia-shared";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import SidebarBody from "@/components/SidebarBody";

/**
 * Mobile-only nav: a hamburger that opens the sidebar in a left drawer (Sheet).
 * The Sheet (radix dialog) gives focus-trap, Esc-to-close, and aria for free.
 * Closes automatically on route change.
 */
export default function MobileNav({
  role,
  email,
}: {
  role: Role;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-accent md:hidden"
        aria-label="打开菜单"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-64 border-zinc-800 bg-zinc-900 p-0 text-zinc-100"
      >
        <SidebarBody role={role} email={email} />
      </SheetContent>
    </Sheet>
  );
}
