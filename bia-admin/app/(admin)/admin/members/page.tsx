import { createBiaServiceRoleClient } from "@bia/shared";
import { requireRole } from "@/lib/auth/require-role";
import MembersClient from "./MembersClient";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const ctx = await requireRole("viewer");

  const admin = createBiaServiceRoleClient();

  const [{ data: admins }, { data: invitations }] = await Promise.all([
    admin
      .from("admin_users")
      .select("id, email, role, created_at")
      .order("created_at", { ascending: true }),
    admin
      .from("admin_invitations")
      .select("id, email, role, created_at, invited_by, accepted_at")
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Officers who can sign in to BIA Admin.
        </p>
      </header>

      <MembersClient
        currentUserId={ctx.user.id}
        currentRole={ctx.role}
        admins={admins ?? []}
        invitations={invitations ?? []}
      />
    </div>
  );
}
