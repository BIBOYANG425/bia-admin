import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";

export default async function AdminHomePage() {
  const { user } = await requireRole("viewer");

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user.email.split("@")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Phase 1 dashboard — full &quot;what needs you today&quot; cards land in Phase 2.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
        <Link href="/admin/members" className="group">
          <Card className="transition-colors group-hover:border-primary">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Members</CardTitle>
              </div>
              <CardDescription>
                Invite officers, change roles, revoke access.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Manage who can sign into the dashboard.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
