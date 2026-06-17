// Shared student account + onboarding contract.
//
// The SINGLE source of truth for what onboarding requires and when it is complete.
// George (george-extract `update_profile`) and the bia-roommate web account/onboarding
// both consume this, so the onboarding field set cannot drift between surfaces.
//
// `missingOnboardingFields` mirrors george-extract src/tools/update-profile.ts:58-64
// exactly (presence check; placeholder values like "undecided"/"unknown" count). Keep them
// in lockstep — george refactors to import these instead of its private REQUIRED_FIELDS.

export type StudentYear =
  | "freshman"
  | "sophomore"
  | "junior"
  | "senior"
  | "grad"
  | "unknown";

export type NotificationFrequency = "daily" | "weekly" | "special_only";

export interface NotificationPrefs {
  events: boolean;
  frequency: NotificationFrequency;
}

// The canonical account/member record (public.students). Same row whether reached via web
// login (user_id -> auth.users) or George (imessage_id / wechat_open_id). Shaped to the live
// Supabase schema of project ujkaregrwrppaehvbahf.
export interface Student {
  id: string;

  // identity edges — a student may have any subset of these
  user_id: string | null; // web login -> auth.users.id
  imessage_id: string | null;
  wechat_open_id: string | null;
  member_id: string | null; // BIA cohort member id

  // profile / onboarding
  name: string | null;
  major: string | null;
  year: StudentYear | null;
  interests: string[] | null;
  interest_tags: string[];
  notification_prefs: NotificationPrefs | null;
  onboarding_complete: boolean;
  onboarding_turn_count: number;
  intro_sent_at: string | null;

  // referral graph
  referral_code: string | null;
  referred_by: string | null;
  referral_count: number;

  // cross-platform link bridge (6-digit code, 10-min TTL)
  link_code: string | null;
  link_code_expires_at: string | null;

  // shipping ops — not part of the onboarding contract
  warehouse_preference: string | null;
  shipping_prefs: Record<string, unknown>;

  // timestamps
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

// The onboarding contract: these four logical fields gate `onboarding_complete`.
// Labels match george's REQUIRED_FIELDS so the "what's next" hint is identical everywhere.
export const ONBOARDING_REQUIRED_FIELDS = [
  "major",
  "year",
  "interests",
  "notification_frequency",
] as const;

export type OnboardingField = (typeof ONBOARDING_REQUIRED_FIELDS)[number];

// Permissive input so this accepts both a raw `students` DB row and partial web form state.
export interface OnboardingProfileInput {
  major?: string | null;
  year?: string | null;
  interests?: readonly string[] | null;
  notification_prefs?: { frequency?: string | null } | null;
}

// Which required fields are still unfilled, in canonical order.
export function missingOnboardingFields(
  s: OnboardingProfileInput,
): OnboardingField[] {
  const has: Record<OnboardingField, boolean> = {
    major: !!s.major,
    year: !!s.year,
    interests: Array.isArray(s.interests) && s.interests.length > 0,
    notification_frequency: !!s.notification_prefs?.frequency,
  };
  return ONBOARDING_REQUIRED_FIELDS.filter((f) => !has[f]);
}

export function isOnboardingComplete(s: OnboardingProfileInput): boolean {
  return missingOnboardingFields(s).length === 0;
}
