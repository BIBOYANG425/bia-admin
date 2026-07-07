import { withRole } from "@/lib/auth/require-role";
import { runArticleTransition } from "@/lib/admin/article-transitions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    return runArticleTransition("reject", id, auth, body);
  });
}
