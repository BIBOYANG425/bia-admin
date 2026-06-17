import { describe, expect, test } from "vitest";

import {
  isOnboardingComplete,
  missingOnboardingFields,
  ONBOARDING_REQUIRED_FIELDS,
} from "./index";

describe("onboarding contract", () => {
  test("empty profile is missing all four required fields", () => {
    expect(missingOnboardingFields({})).toEqual([...ONBOARDING_REQUIRED_FIELDS]);
    expect(isOnboardingComplete({})).toBe(false);
  });

  test("complete when all four present — placeholder values still count", () => {
    const s = {
      major: "undecided",
      year: "unknown",
      interests: ["unknown"],
      notification_prefs: { events: true, frequency: "weekly" },
    };
    expect(missingOnboardingFields(s)).toEqual([]);
    expect(isOnboardingComplete(s)).toBe(true);
  });

  test("an empty interests array does NOT satisfy interests", () => {
    const s = {
      major: "CS",
      year: "freshman",
      interests: [],
      notification_prefs: { frequency: "daily" },
    };
    expect(missingOnboardingFields(s)).toEqual(["interests"]);
    expect(isOnboardingComplete(s)).toBe(false);
  });

  test("notification_frequency requires notification_prefs.frequency", () => {
    const base = { major: "CS", year: "freshman", interests: ["AI"] };
    expect(missingOnboardingFields(base)).toEqual(["notification_frequency"]);
    // an empty prefs object is still missing the frequency
    expect(missingOnboardingFields({ ...base, notification_prefs: {} })).toEqual([
      "notification_frequency",
    ]);
  });

  test("lists only the missing fields, in canonical order", () => {
    const s = { major: "CS", interests: ["AI", "music"] };
    expect(missingOnboardingFields(s)).toEqual(["year", "notification_frequency"]);
  });

  test("mirrors george update_profile completion on a full DB-shaped row", () => {
    // george checks: major, year, interests.length>0, notification_prefs.frequency
    const georgeAfterRow = {
      major: "Business",
      year: "junior",
      interests: ["startups", "film", "basketball"],
      notification_prefs: { events: true, frequency: "daily" },
    };
    expect(isOnboardingComplete(georgeAfterRow)).toBe(true);
  });
});
