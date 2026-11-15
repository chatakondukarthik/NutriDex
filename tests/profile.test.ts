import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE,
  bmr,
  bmrSource,
  dailyEnergyKcal,
  energyBreakdown,
  isDefaultProfile,
  maintenanceKcal,
  paceRateKgPerWeek,
  parseProfile,
  projectionWeeks,
  proteinGrams,
  type Profile,
} from "@/lib/profile";
import { makeProfile, rollup } from "@/lib/nutrition/engine";
import { assessDay, assessWeek, targetsFor } from "@/lib/targets";

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
  bodyFatPercent: null,
  pace: "steady",
  targetWeightKg: null,
  targetEnergyKcal: null,
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
    // Targets are rounded to 5 g, because a gram of protein is not a
    // meaningful distinction at this level.
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

describe("pace and body composition", () => {
  it("uses Katch–McArdle when body fat is known", () => {
    const measured = { ...woman, bodyFatPercent: 25 };
    // lean mass = 60 × 0.75 = 45 kg → 370 + 21.6 × 45
    expect(bmr(measured)).toBeCloseTo(1342, 5);
    expect(bmrSource(measured)).toBe("katch");
    expect(bmrSource(woman)).toBe("mifflin");
  });

  it("turns a pace into a kg-per-week rate that follows body weight", () => {
    expect(paceRateKgPerWeek({ ...woman, goal: "lose", pace: "gentle" })).toBe(0.15);
    expect(paceRateKgPerWeek({ ...woman, goal: "lose", pace: "steady" })).toBe(0.3);
    expect(paceRateKgPerWeek({ ...woman, goal: "lose", pace: "fast" })).toBe(0.45);
    expect(paceRateKgPerWeek({ ...woman, goal: "gain", pace: "steady" })).toBe(0.15);
    expect(paceRateKgPerWeek(woman)).toBe(0);
  });

  it("makes a faster pace a larger adjustment", () => {
    const gentle = energyBreakdown({ ...woman, goal: "lose", pace: "gentle" });
    const steady = energyBreakdown({ ...woman, goal: "lose", pace: "steady" });
    const fast = energyBreakdown({ ...woman, goal: "lose", pace: "fast" });

    expect(gentle.target).toBeGreaterThan(steady.target);
    expect(steady.target).toBeGreaterThan(fast.target);
  });

  it("caps a deficit at 25% of maintenance", () => {
    const breakdown = energyBreakdown({
      ...woman,
      goal: "lose",
      pace: "fast",
      weightKg: 120,
      heightCm: 190,
    });
    expect(breakdown.cap).toBe("deficit");
    expect(Math.abs(breakdown.delta)).toBeCloseTo(breakdown.maintenance * 0.25, 5);
  });

  it("reports the rate the rails actually allow, not the one asked for", () => {
    const uncapped = energyBreakdown({ ...woman, goal: "lose", pace: "steady" });
    expect(uncapped.cap).toBeNull();
    expect(uncapped.effectiveRateKgPerWeek).toBe(0.3);

    // At 120 kg the fast pace asks for 0.9 kg/week, which is more than a
    // 25 % deficit can deliver.
    const capped = energyBreakdown({
      ...woman,
      weightKg: 120,
      heightCm: 190,
      goal: "lose",
      pace: "fast",
    });
    expect(capped.cap).toBe("deficit");
    expect(capped.rateKgPerWeek).toBe(0.9);
    expect(capped.effectiveRateKgPerWeek).toBeLessThan(capped.rateKgPerWeek);
    expect(capped.effectiveRateKgPerWeek).toBeCloseTo(0.73, 2);
  });

  it("keeps the projection honest when a cap slows the rate", () => {
    const capped = {
      ...woman,
      weightKg: 120,
      heightCm: 190,
      goal: "lose" as const,
      pace: "fast" as const,
      targetWeightKg: 114,
    };

    // 6 kg at the capped 0.73 kg/week, not the requested 0.9.
    expect(projectionWeeks(capped)).toBe(9);
  });

  it("projects a time to the target weight only in the right direction", () => {
    const losing = { ...woman, goal: "lose" as const, targetWeightKg: 54 };
    expect(projectionWeeks(losing)).toBe(20); // 6 kg at 0.3 kg/week

    expect(projectionWeeks({ ...woman, goal: "lose", targetWeightKg: 66 })).toBeNull();
    expect(projectionWeeks({ ...woman, goal: "maintain", targetWeightKg: 55 })).toBeNull();
    expect(projectionWeeks({ ...woman, goal: "lose", targetWeightKg: null })).toBeNull();
  });
});

describe("guidance roles", () => {
  it("marks energy and protein as daily anchors", () => {
    const byCode = new Map(targetsFor(woman).map((target) => [target.code, target]));
    expect(byCode.get("ENERC_KCAL")!.role).toBe("daily-anchor");
    expect(byCode.get("PROCNT")!.role).toBe("daily-anchor");
  });

  it("marks fat, sugar and sodium as weekly limits", () => {
    const byCode = new Map(targetsFor(woman).map((target) => [target.code, target]));
    expect(byCode.get("FAT")!.role).toBe("weekly-limit");
    expect(byCode.get("SUGAR")!.role).toBe("weekly-limit");
    expect(byCode.get("NA")!.role).toBe("weekly-limit");
  });

  it("marks fibre and micronutrients as weekly minimums", () => {
    const byCode = new Map(targetsFor(woman).map((target) => [target.code, target]));
    expect(byCode.get("FIBTG")!.role).toBe("weekly-minimum");
    expect(byCode.get("FE")!.role).toBe("weekly-minimum");
  });
});

describe("day and week assessment", () => {
  const targets = targetsFor(woman);
  const energyTarget = targets.find((target) => target.code === "ENERC_KCAL")!;
  const fibreTarget = targets.find((target) => target.code === "FIBTG")!;
  const sodiumTarget = targets.find((target) => target.code === "NA")!;

  function rollupWith(amounts: Partial<Record<string, number>>) {
    return rollup([
      {
        label: "test",
        profile: makeProfile(amounts as never, "test"),
        grams: 100,
      },
    ]);
  }

  it("treats an empty day as unknown, not zero", () => {
    const assessment = assessDay(rollup([]), targets);
    expect(assessment.every((entry) => entry.status === "unknown")).toBe(true);
  });

  it("passes judgement on a daily anchor", () => {
    const onTarget = assessDay(rollupWith({ ENERC_KCAL: energyTarget.value }), targets);
    expect(onTarget.find((entry) => entry.code === "ENERC_KCAL")!.status).toBe("met");

    const low = assessDay(rollupWith({ ENERC_KCAL: energyTarget.value * 0.5 }), targets);
    expect(low.find((entry) => entry.code === "ENERC_KCAL")!.status).toBe("low");
  });

  it("does not call a short day a failure for a weekly minimum", () => {
    const day = assessDay(rollupWith({ FIBTG: fibreTarget.value * 0.2 }), targets);
    expect(day.find((entry) => entry.code === "FIBTG")!.status).toBe("neutral");
  });

  it("judges a weekly minimum over the week", () => {
    const week = assessWeek(
      Array.from({ length: 7 }, () =>
        rollupWith({ FIBTG: fibreTarget.value }),
      ),
      targets,
    );
    const fibre = week.find((entry) => entry.code === "FIBTG")!;
    expect(fibre.status).toBe("met");
    expect(fibre.target).toBeCloseTo(fibreTarget.value * 7, 5);
  });

  it("judges a weekly limit over the week", () => {
    const days = Array.from({ length: 7 }, () =>
      rollupWith({ NA: sodiumTarget.value * 1.5 }),
    );
    const week = assessWeek(days, targets);
    expect(week.find((entry) => entry.code === "NA")!.status).toBe("high");
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

  it("accepts the optional body composition and goal fields", () => {
    const parsed = parseProfile({
      ...woman,
      bodyFatPercent: "24.5",
      pace: "fast",
      targetWeightKg: "55",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.bodyFatPercent).toBe(24.5);
    expect(parsed.profile.pace).toBe("fast");
    expect(parsed.profile.targetWeightKg).toBe(55);
  });

  it("treats an empty optional field as absent", () => {
    const parsed = parseProfile({
      ...woman,
      bodyFatPercent: "",
      targetWeightKg: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.bodyFatPercent).toBeNull();
    expect(parsed.profile.targetWeightKg).toBeNull();
  });

  it("defaults a missing pace to steady", () => {
    const parsed = parseProfile({ ...woman, pace: undefined });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.profile.pace).toBe("steady");
  });

  it("rejects an impossible body fat or an unknown pace", () => {
    expect(parseProfile({ ...woman, bodyFatPercent: 80 }).ok).toBe(false);
    expect(parseProfile({ ...woman, bodyFatPercent: 1 }).ok).toBe(false);
    expect(parseProfile({ ...woman, pace: "sprint" }).ok).toBe(false);
    expect(parseProfile({ ...woman, targetWeightKg: 10 }).ok).toBe(false);
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
