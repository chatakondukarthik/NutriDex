import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE,
  bmr,
  dailyEnergyKcal,
  isDefaultProfile,
  maintenanceKcal,
  parseProfile,
  proteinGrams,
  type Profile,
} from "@/lib/profile";
import { targetsFor } from "@/lib/targets";

/**
 * The profile is the only place a person's numbers enter the system, and
 * every target is derived from it. These tests pin the arithmetic and the
 * guard rails, not the exact reference values — those are seed data and
 * are expected to move when Q-003 is answered.
 */

const woman: Profile = {
  sex: "female",
  ageYears: 30,
  heightCm: 165,
  weightKg: 60,
  activity: "moderate",
  goal: "maintain",
};

const man: Profile = { ...woman, sex: "male", weightKg: 70, heightCm: 175 };

describe("energy", () => {
  it("uses Mifflin–St Jeor", () => {
    // 10×60 + 6.25×165 − 5×30 − 161
    expect(bmr(woman)).toBeCloseTo(1320.25, 2);
    // 10×70 + 6.25×175 − 5×30 + 5
    expect(bmr(man)).toBeCloseTo(1648.75, 2);
  });

  it("applies the activity multiplier to the basal rate", () => {
    expect(maintenanceKcal(woman)).toBeCloseTo(bmr(woman) * 1.55, 5);
  });

  it("moves the target down to lose and up to gain", () => {
    const maintain = dailyEnergyKcal(woman);
    expect(dailyEnergyKcal({ ...woman, goal: "lose" })).toBeLessThan(maintain);
    expect(dailyEnergyKcal({ ...woman, goal: "gain" })).toBeGreaterThan(maintain);
  });

  it("rounds the target to a readable step", () => {
    expect(dailyEnergyKcal(woman) % 10).toBe(0);
  });

  it("never recommends a very low intake, even for a tiny body", () => {
    const tiny: Profile = { ...woman, weightKg: 25, heightCm: 100, ageYears: 100 };
    expect(dailyEnergyKcal({ ...tiny, goal: "lose" })).toBe(1200);
    expect(dailyEnergyKcal({ ...tiny, sex: "male", goal: "lose" })).toBe(1500);
  });
});

describe("protein", () => {
  it("scales with body weight and goal", () => {
    expect(proteinGrams(woman)).toBe(60);
    expect(proteinGrams({ ...woman, goal: "lose" })).toBe(70);
    expect(proteinGrams({ ...woman, goal: "gain" })).toBe(85);
  });
});

describe("targetsFor", () => {
  it("derives energy and protein from the profile", () => {
    const targets = targetsFor(woman);
    const byCode = new Map(targets.map((target) => [target.code, target]));

    expect(byCode.get("ENERC_KCAL")!.value).toBe(dailyEnergyKcal(woman));
    expect(byCode.get("PROCNT")!.value).toBe(proteinGrams(woman));
  });

  it("takes each nutrient's direction from the vocabulary", () => {
    const byCode = new Map(targetsFor(woman).map((target) => [target.code, target]));

    expect(byCode.get("FAT")!.direction).toBe("max");
    expect(byCode.get("SUGAR")!.direction).toBe("max");
    expect(byCode.get("NA")!.direction).toBe("max");
    expect(byCode.get("PROCNT")!.direction).toBe("min");
  });

  it("gives every tracked nutrient a target", () => {
    expect(targetsFor(woman)).toHaveLength(18);
  });

  it("uses the sex-specific iron and calcium reference values", () => {
    const younger = new Map(targetsFor(woman).map((target) => [target.code, target]));
    const older = new Map(
      targetsFor({ ...woman, ageYears: 55 }).map((target) => [target.code, target]),
    );
    const male = new Map(targetsFor(man).map((target) => [target.code, target]));

    expect(younger.get("FE")!.value).toBe(29);
    expect(older.get("FE")!.value).toBe(19);
    expect(male.get("FE")!.value).toBe(19);

    expect(younger.get("CA")!.value).toBe(1000);
    expect(older.get("CA")!.value).toBe(1200);
  });
});

describe("parseProfile", () => {
  it("accepts a complete, in-range profile", () => {
    const parsed = parseProfile(woman);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile).toEqual(woman);
  });

  it("accepts numbers arriving as strings from a form", () => {
    const parsed = parseProfile({
      ...woman,
      ageYears: "30",
      heightCm: "165",
      weightKg: "60",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.ageYears).toBe(30);
  });

  it.each([
    [{ ...woman, sex: "other" }, /sex/i],
    [{ ...woman, ageYears: 9 }, /age/i],
    [{ ...woman, ageYears: 101 }, /age/i],
    [{ ...woman, heightCm: 90 }, /height/i],
    [{ ...woman, weightKg: 0 }, /weight/i],
    [{ ...woman, activity: "sometimes" }, /activity/i],
    [{ ...woman, goal: "bulk" }, /goal/i],
    [{ ...woman, ageYears: "abc" }, /age/i],
  ])("rejects %o", (input, message) => {
    const parsed = parseProfile(input);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toMatch(message);
  });

  it("rejects a missing profile", () => {
    expect(parseProfile(null).ok).toBe(false);
  });
});

describe("isDefaultProfile", () => {
  it("recognises the untouched default", () => {
    expect(isDefaultProfile(DEFAULT_PROFILE)).toBe(true);
  });

  it("is false once any field changes", () => {
    expect(isDefaultProfile({ ...DEFAULT_PROFILE, weightKg: 61 })).toBe(false);
  });
});
