import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, RoleError } from "@/lib/auth/require-role";
import SidebarNav from "@/components/SidebarNav";

export default async function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  let ctx: Awaited<ReturnType<typeof requireRole>>;
  try {
    ctx = await requireRole("viewer");
  } catch (err) {
    if (err instanceof RoleError && err.status === 401) {
      redirect("/login");
    }
    if (err instanceof RoleError && err.status === 403) {
      redirect("/login?denied=not-invited");
    }
    throw err;
  }

  return (
    <div className="min-h-screen flex bg-zinc-50 text-foreground">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-zinc-900 text-zinc-100 flex flex-col p-4">
        <Link
          href="/admin"
          className="text-lg font-bold tracking-tight mb-6 px-2"
        >
          BIA Admin
        </Link>
        <SidebarNav />
        <div className="mt-auto pt-4 border-t border-zinc-800 px-2 text-xs">
          <p className="text-zinc-400 truncate">{ctx.user.email}</p>
          <p className="text-zinc-500 capitalize">{ctx.role.replace("_", " ")}</p>
          <form action="/auth/signout" method="POST" className="mt-2">
            <button
              type="submit"
              className="text-zinc-400 hover:text-white text-xs underline-offset-2 hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
