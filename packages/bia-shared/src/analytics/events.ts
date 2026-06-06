/* ── Analytics event taxonomy ───────────────────────────────────────────────
 * Single source of truth for product-analytics event names, shared by
 * uscbia.com (bia-roommate) and admin.uscbia.com (bia-admin) so BOTH apps emit
 * the SAME event names. Pure data/types, zero deps. Wired to a provider
 * (PostHog) via setAnalyticsSink() in ./index.ts.
 *
 * Retention-roadmap Phase 0. Add events as features land; keep names stable
 * once shipped (renaming breaks historical cohorts/funnels).
 * ──────────────────────────────────────────────────────────────────────────── */

export const ANALYTICS_EVENTS = {
  // 集运 / shipping
  shippingParcelDeclared: "shipping_parcel_declared",
  shippingParcelStatusViewed: "shipping_parcel_status_viewed",
  // 找室友 / roommates
  roommatePostCreated: "roommate_post_created",
  roommateContacted: "roommate_contacted",
  // 转租 / sublet
  subletPostCreated: "sublet_post_created",
  // 找搭子 / squad
  squadJoined: "squad_joined",
  // 选课 / course planner + 课评 / reviews
  coursePlanGenerated: "course_plan_generated",
  courseReviewSubmitted: "course_review_submitted",
  // 通知 / notifications (Phase 1a)
  notificationOpened: "notification_opened",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
