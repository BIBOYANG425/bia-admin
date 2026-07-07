import { withRole } from "@/lib/auth/require-role";
import { runArticleTransition } from "@/lib/admin/article-transitions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  return withRole("editor", async (auth) => {
    const { id } = await ctx.params;
    return runArticleTransition("submit", id, auth);
  });
}
