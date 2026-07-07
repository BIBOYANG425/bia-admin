import { withRole } from "@/lib/auth/require-role";
import { runArticleTransition } from "@/lib/admin/article-transitions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  return withRole("super_admin", async (auth) => {
    const { id } = await ctx.params;
    return runArticleTransition("publish", id, auth);
  });
}
