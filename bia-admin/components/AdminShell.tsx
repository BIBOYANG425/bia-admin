import { redirect } from "next/navigation";
import { requireRole, RoleError } from "@/lib/auth/require-role";
import SidebarBody from "@/components/SidebarBody";
import TopBar from "@/components/TopBar";

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
    <div className="flex min-h-screen bg-zinc-50 text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-1.5 focus:text-sm focus:shadow"
      >
        跳到主内容
      </a>
      {/* Desktop sidebar — hidden on mobile, replaced by the TopBar drawer. */}
      <aside className="hidden w-60 shrink-0 bg-zinc-900 text-zinc-100 md:block">
        <SidebarBody role={ctx.role} email={ctx.user.email} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar role={ctx.role} email={ctx.user.email} />
        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
