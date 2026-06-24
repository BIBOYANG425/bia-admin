import Link from "next/link";
import type { Role } from "@biboyang425/bia-shared";
import SidebarNav from "@/components/SidebarNav";

/**
 * The inner content of the admin sidebar — logo, nav, and the account footer.
 * Shared by the static desktop aside (AdminShell) and the mobile drawer
 * (MobileNav) so the two never drift.
 */
export default function SidebarBody({
  role,
  email,
}: {
  role: Role;
  email: string;
}) {
  return (
    <div className="flex h-full flex-col p-4">
      <Link href="/admin" className="mb-6 px-2 text-lg font-bold tracking-tight">
        BIA Admin
      </Link>
      <SidebarNav role={role} />
      <div className="mt-auto border-t border-zinc-800 px-2 pt-4 text-xs">
        <p className="truncate text-zinc-400">{email}</p>
        <p className="flex items-center gap-1.5 text-zinc-500">
          <span className="capitalize">{role.replace("_", " ")}</span>
          {role === "viewer" ? (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              只读
            </span>
          ) : null}
        </p>
        <form action="/auth/signout" method="POST" className="mt-2">
          <button
            type="submit"
            className="text-xs text-zinc-400 underline-offset-2 hover:text-white hover:underline"
          >
            Sign out
          </button>
        </form>
        <Link
          href="/privacy"
          className="mt-3 block text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
        >
          Privacy
        </Link>
      </div>
    </div>
  );
}
