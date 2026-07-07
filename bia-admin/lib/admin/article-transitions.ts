import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import { writeAudit } from "@/lib/admin/audit-log";
import { findAvailableSlug } from "@/lib/admin/slug";
import type { RequireRoleResult } from "@/lib/auth/require-role";

type AdminClient = ReturnType<typeof createBiaServiceRoleClient>;

/** Subset of article fields the runner always selects. */
interface ArticleRow {
  id: string;
  status: string;
  slug: string;
}

type PreHookResult =
  | { ok: true; extra: Record<string, unknown> }
  | { ok: false; response: NextResponse };

interface ArticleTransition {
  /** Valid source statuses; a 409 is returned if `existing.status` is absent. */
  fromStatuses: string[];
  /**
   * Target status — mirrors the `status` field set by buildUpdate; exposed
   * explicitly so the table test can assert it without calling buildUpdate.
   */
  toStatus: string;
  /** Error key for the 500 response when the DB update call fails. */
  updateErrorKey: string;
  /**
   * Optional pre-update hook. Runs after the status guard, before the DB
   * write. Returns extra fields to merge into the update patch on success, or
   * a short-circuit NextResponse on failure (e.g. slug_lookup_failed).
   */
  preHook?: (
    admin: AdminClient,
    existing: ArticleRow,
    id: string,
  ) => Promise<PreHookResult>;
  /**
   * Build the DB update patch. Must include the `status` field equal to
   * `toStatus`. The runner spreads any preHook extras on top of this.
   */
  buildUpdate: (
    auth: RequireRoleResult,
    existing: ArticleRow,
    body?: Record<string, unknown>,
  ) => Record<string, unknown>;
  /** Action string written to the audit log. */
  auditAction: string;
  /**
   * Build the audit payload. When undefined, `writeAudit` is called without
   * a `payload` key — matching the original per-route behavior for submit and
   * unpublish.
   */
  buildAuditPayload?: (
    existing: ArticleRow,
    body?: Record<string, unknown>,
  ) => Record<string, unknown>;
}

export type TransitionAction = "submit" | "publish" | "reject" | "unpublish";

export const TRANSITIONS: Record<TransitionAction, ArticleTransition> = {
  submit: {
    fromStatuses: ["draft"],
    toStatus: "in_review",
    updateErrorKey: "update_failed",
    preHook: async (admin, existing, id): Promise<PreHookResult> => {
      const slugResult = await findAvailableSlug(admin, existing.slug, {
        excludeId: id,
      });
      if (slugResult.error) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "slug_lookup_failed", details: slugResult.error.message },
            { status: 500 },
          ),
        };
      }
      return { ok: true, extra: { slug: slugResult.slug } };
    },
    buildUpdate: (auth) => ({
      status: "in_review",
      submitted_at: new Date().toISOString(),
      submitted_by: auth.adminUser.id,
      // Clear any prior rejection — once the article moves forward the note
      // no longer applies. Audit log retains the history.
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
    }),
    auditAction: "article.submit",
  },

  publish: {
    fromStatuses: ["in_review", "unpublished"],
    toStatus: "published",
    // Slug uniqueness at publish time is owned by the DB partial unique index
    // (migration 20260524000003); no app-layer bump needed here.
    updateErrorKey: "publish_failed",
    buildUpdate: (auth) => ({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: auth.adminUser.id,
      unpublished_at: null,
      unpublished_by: null,
      // Clear any pending schedule — a manual transition wins, and a stale
      // scheduled_publish_at would let the cron re-publish after a takedown.
      scheduled_publish_at: null,
    }),
    auditAction: "article.publish",
    buildAuditPayload: (existing) => ({ slug: existing.slug }),
  },

  reject: {
    fromStatuses: ["in_review"],
    toStatus: "draft",
    updateErrorKey: "update_failed",
    buildUpdate: (auth, _existing, body) => {
      const reason =
        typeof body?.reason === "string" ? body.reason : undefined;
      return {
        status: "draft",
        submitted_at: null,
        submitted_by: null,
        // Record the rejection so the editor banner can show the author what
        // changed. Cleared by the submit handler when the article moves
        // forward again.
        rejected_at: new Date().toISOString(),
        rejected_by: auth.adminUser.id,
        rejection_reason: reason ?? null,
        // Clear any pending schedule so a rejected draft isn't auto-published.
        scheduled_publish_at: null,
      };
    },
    auditAction: "article.reject",
    buildAuditPayload: (_existing, body) => {
      const reason =
        typeof body?.reason === "string" ? body.reason : undefined;
      return reason ? { reason } : {};
    },
  },

  unpublish: {
    fromStatuses: ["published"],
    toStatus: "unpublished",
    updateErrorKey: "update_failed",
    buildUpdate: (auth) => ({
      status: "unpublished",
      unpublished_at: new Date().toISOString(),
      unpublished_by: auth.adminUser.id,
      // Clear any pending schedule so the cron can't re-publish this takedown.
      scheduled_publish_at: null,
    }),
    auditAction: "article.unpublish",
  },
};

/**
 * Table-driven article transition runner.
 *
 * Shared skeleton for submit / publish / reject / unpublish:
 *   1. Lookup the article (404 / 500 on error).
 *   2. Status guard against config.fromStatuses (409 on mismatch).
 *   3. Run optional preHook (e.g. slug finalization for submit).
 *   4. DB update with merged patch (500 on error).
 *   5. Audit log write.
 *   6. Return the updated article row as JSON.
 *
 * Each route calls this after withRole() resolves, keeping role enforcement
 * at the route layer where it belongs.
 */
export async function runArticleTransition(
  action: TransitionAction,
  id: string,
  auth: RequireRoleResult,
  body?: Record<string, unknown>,
): Promise<NextResponse> {
  const config = TRANSITIONS[action];
  const admin = createBiaServiceRoleClient();

  const { data: existing, error: lookupError } = await admin
    .from("articles")
    .select("id, status, slug")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: "lookup_failed", details: lookupError.message },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row: ArticleRow = existing as unknown as ArticleRow;
  if (!config.fromStatuses.includes(row.status)) {
    return NextResponse.json(
      { error: "invalid_transition", from: row.status },
      { status: 409 },
    );
  }

  const hookExtra: Record<string, unknown> = {};
  if (config.preHook) {
    const result = await config.preHook(admin, row, id);
    if (!result.ok) return result.response;
    Object.assign(hookExtra, result.extra);
  }

  const patch = {
    ...config.buildUpdate(auth, row, body),
    // preHook extras intentionally override buildUpdate fields (today only
    // submit's slug uses this and there is no overlap).
    ...hookExtra,
  };

  const { data, error } = await admin
    .from("articles")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: config.updateErrorKey, details: error.message },
      { status: 500 },
    );
  }

  await writeAudit({
    admin_email: auth.user.email,
    action: config.auditAction,
    entity_type: "article",
    entity_id: id,
    ...(config.buildAuditPayload
      ? { payload: config.buildAuditPayload(row, body) }
      : {}),
  });

  return NextResponse.json(data);
}
