import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BlogEditor } from "@/components/blog/BlogEditor";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

export default async function NewArticlePage() {
  const { role } = await requireRole("editor");

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="w-fit px-0">
          <Link href="/admin/blog">
            <ArrowLeft className="h-4 w-4" />
            Blog
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New article</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a draft for review before publishing.
          </p>
        </div>
      </header>

      <BlogEditor role={role} />
    </div>
  );
}
