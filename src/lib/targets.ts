import { combine, type NutrientCoverage, type Rollup } from "@/lib/nutrition/engine";
import { NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";
import { energyBreakdown, type Profile } from "@/lib/profile";

/**
 * Daily targets, and how to read them over a day and a week.
 *
 * Derived from a profile rather than hardcoded, so the diary and the plan
 * share one source of truth and changing the profile moves both.
 *
 * **Where the numbers come from.** Energy, protein, fat, carbohydrate,
 * fibre and sugar are computed from the profile (Mifflin–St Jeor or
 * Katch–McArdle, activity level, goal, g/kg). Minerals and vitamins are
 * seed values from the ICMR–NIN 2020 Recommended Dietary Allowances for
 * Indians, banded by sex and age.
 *
 * **What that means.** They are reference values for a population, not a
 * prescription for a person, and they have not been through a verified
 * review. Q-003 in `docs/research/RESEARCH.md` is still open: one value
 * per nutrient versus a range, and whether a `max` is a limit or a goal.
 * The UI therefore shows them as targets to aim at, never as a pass/fail.
 *
 * **Day versus week.** Dietary reference intakes are defined as an average
 * intake over time, not a requirement on every single day. So each target
 * carries a role:
 *
 * - `daily-anchor` — energy and protein. Hit these most days; a day that
 *   is wildly low or high is worth noticing.
 * - `weekly-minimum` — fibre, carbohydrate and the micronutrients. A low
 *   day is fine when the week averages out.
 * - `weekly-limit` — fat, sugars and sodium. A high day is fine when the
 *   week averages out.
 *
 * The week assessment is what turns those roles into a verdict; the day
 * assessment only passes judgement on the anchors.
 */

export type GuidanceRole = "daily-anchor" | "weekly-minimum" | "weekly-limit";

export interface Target {
  code: NutrientCode;
  /** Reference amount for one day. */
  value: number;
  direction: "min" | "max";
  period: "day";
  role: GuidanceRole;
  /** How far from the reference still counts as on target, as a fraction. */
  tolerance: number;
}

export interface GuidanceGroup {
  role: GuidanceRole;
  label: string;
  short: string;
  blurb: string;
}

export const GUIDANCE_GROUPS: GuidanceGroup[] = [
  {
    role: "daily-anchor",
    label: "Hit most days",
    short: "Daily",
    blurb:
      "Energy and protein steer the plan. Close to target most days is what matters; one unusual day is not a failure.",
  },
  {
    role: "weekly-minimum",
    label: "Reach across the week",
    short: "Weekly minimum",
    blurb:
      "A low day is fine if the week adds up. Reference intakes are averages over time, not a daily test.",
  },
  {
    role: "weekly-limit",
    label: "Stay under across the week",
    short: "Weekly limit",
    blurb:
      "A high day is fine if the week averages out. These are ceilings, so the bar turning amber is the signal.",
  },
];

const ROLE_BY_CODE: Record<NutrientCode, GuidanceRole> = {
  ENERC_KCAL: "daily-anchor",
  PROCNT: "daily-anchor",
  FAT: "weekly-limit",
  CHOCDF: "weekly-minimum",
  FIBTG: "weekly-minimum",
  SUGAR: "weekly-limit",
  NA: "weekly-limit",
  K: "weekly-minimum",
  CA: "weekly-minimum",
  FE: "weekly-minimum",
  ZN: "weekly-minimum",
  MG: "weekly-minimum",
  VITA_RAE: "weekly-minimum",
  VITC: "weekly-minimum",
  VITD: "weekly-minimum",
  VITB12: "weekly-minimum",
  FOL: "weekly-minimum",
  VITB6: "weekly-minimum",
};

const TOLERANCE: Partial<Record<NutrientCode, number>> = {
  ENERC_KCAL: 0.1,
  PROCNT: 0.1,
  FAT: 0.1,
  SUGAR: 0.15,
  NA: 0.1,
};

/**
 * Build the daily target set for a profile.
 *
 * Direction comes from the nutrient vocabulary, so a nutrient cannot be a
 * limit in one screen and a minimum in another. The role comes from the
 * table above for the same reason.
 */
export function targetsFor(profile: Profile): Target[] {
  const breakdown = energyBreakdown(profile);

  const values: Record<NutrientCode, number> = {
    ENERC_KCAL: breakdown.target,
    PROCNT: breakdown.protein,
    FAT: breakdown.fat,
    CHOCDF: breakdown.carbs,
    FIBTG: breakdown.fibre,
    SUGAR: breakdown.sugar,
    NA: 2000,
    K: 3500,
    CA: profile.ageYears >= 51 ? 1200 : 1000,
    // Iron is the clearest sex-specific value, and the one most likely to
    // be wrong for an individual. Menstruating women need substantially
    // more than men.
    FE: profile.sex === "female" && profile.ageYears < 51 ? 29 : 19,
    ZN: profile.sex === "female" ? 13 : 17,
    MG: profile.sex === "female" ? 370 : 440,
    VITA_RAE: profile.sex === "female" ? 840 : 1000,
    VITC: 80,
    VITD: 15,
    VITB12: 2.2,
    FOL: 300,
    VITB6: 1.3,
  };

  return (Object.keys(values) as NutrientCode[]).map((code) => ({
    code,
    value: values[code],
    direction: NUTRIENTS[code].direction,
    period: "day" as const,
    role: ROLE_BY_CODE[code],
    tolerance: TOLERANCE[code] ?? 0.1,
  }));
}

export function targetMap(targets: Target[]): Map<NutrientCode, Target> {
  return new Map(targets.map((target) => [target.code, target]));
}

/* ------------------------------------------------------------ assessment */

export type AssessmentStatus = "unknown" | "low" | "met" | "high" | "neutral";

export type AssessmentPeriod = "day" | "week";

export interface Assessment {
  code: NutrientCode;
  role: GuidanceRole;
  status: AssessmentStatus;
  /** Amount in the period. A lower bound when coverage is partial. */
  actual: number | null;
  /** Reference for the period: the daily value, or the daily value × 7. */
  target: number;
  /** `actual / target`, or null when unknown. */
  ratio: number | null;
  coverage: NutrientCoverage;
}

/** The reference amount for a period. Weeks are seven days, by definition. */
export function periodTarget(target: Target, period: AssessmentPeriod): number {
  return period === "day" ? target.value : target.value * 7;
}

/**
 * Assess one day.
 *
 * Only the daily anchors get a low/high verdict. The other roles still
 * colour a met minimum or an exceeded limit, but a shortfall is `neutral`
 * rather than `low` — that is the whole point of a weekly target.
 */
export function assessDay(rollup: Rollup, targets: Target[]): Assessment[] {
  return targets.map((target) => {
    const actual = rollup.totals[target.code];
    const coverage = rollup.coverage[target.code];
    const reference = periodTarget(target, "day");

    if (actual == null) {
      return {
        code: target.code,
        role: target.role,
        status: "unknown" as const,
        actual: null,
        target: reference,
        ratio: null,
        coverage,
      };
    }

    const ratio = actual / reference;
    const high = ratio > 1 + target.tolerance;
    const met = ratio >= 1 - target.tolerance;

    let status: AssessmentStatus;
    if (target.role === "daily-anchor") {
      status = high ? "high" : met ? "met" : "low";
    } else if (target.role === "weekly-limit") {
      status = high ? "high" : "neutral";
    } else {
      status = met ? "met" : "neutral";
    }

    return {
      code: target.code,
      role: target.role,
      status,
      actual,
      target: reference,
      ratio,
      coverage,
    };
  });
}

/**
 * Assess a set of days as one week.
 *
 * Totals are combined with `combine`, so partial coverage stays visible:
 * a week total is a lower bound when any planned item is missing a value.
 * Pass exactly the days you want to judge — the plan board passes the
 * week's seven days.
 */
export function assessWeek(rollups: Rollup[], targets: Target[]): Assessment[] {
  const combined = combine(rollups);

  return targets.map((target) => {
    const actual = combined.totals[target.code];
    const coverage = combined.coverage[target.code];
    const reference = periodTarget(target, "week");

    if (actual == null) {
      return {
        code: target.code,
        role: target.role,
        status: "unknown" as const,
        actual: null,
        target: reference,
        ratio: null,
        coverage,
      };
    }

    const ratio = actual / reference;
    const over = ratio > 1 + target.tolerance;
    const under = ratio < 1 - target.tolerance;

    const status: AssessmentStatus =
      target.role === "weekly-limit"
        ? over
          ? "high"
          : "met"
        : under
          ? "low"
          : "met";

    return {
      code: target.code,
      role: target.role,
      status,
      actual,
      target: reference,
      ratio,
      coverage,
    };
  });
}

export function assessmentMap(assessments: Assessment[]): Map<NutrientCode, Assessment> {
  return new Map(assessments.map((assessment) => [assessment.code, assessment]));
}

/** Targets for one guidance group, in vocabulary order. */
export function targetsInRole(targets: Target[], role: GuidanceRole): Target[] {
  return targets.filter((target) => target.role === role);
}
