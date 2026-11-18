import { combine, type NutrientCoverage, type Rollup } from "@/lib/nutrition/engine";
import { NUTRIENTS, NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";
import { energyBreakdown, energyMacros, type Profile } from "@/lib/profile";

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

/**
 * How a bar reads a ratio, and how much deviation still counts as on target.
 *
 * The defaults are the behaviour the app shipped with: amber as soon as an
 * amount passes the target, red at 20% over, and a ±10% verdict tolerance
 * (±15% for sugar, whose label values are less precise). They are stored as
 * fractions so the assessment and the bar cannot disagree, and a user can
 * move them in Settings without touching code.
 */
export interface TargetRules {
  /** Fraction over target where amber starts. 0 means "as soon as it is over". */
  amberOver: number;
  /** Fraction over target where red starts. Must be at least `amberOver`. */
  redAt: number;
  /** Fraction of the target that still counts as met, below or above. */
  tolerance: number;
  /** Sugar gets its own, wider tolerance by default. */
  sugarTolerance: number;
  /** User-set daily reference values. A missing code uses the profile value. */
  overrides: Partial<Record<NutrientCode, number>>;
}

export const DEFAULT_TARGET_RULES: TargetRules = {
  amberOver: 0,
  redAt: 0.2,
  tolerance: 0.1,
  sugarTolerance: 0.15,
  overrides: {},
};

const MAX_TARGET_OVERRIDE = 100_000;

/**
 * Read a stored or submitted rule set without trusting it.
 *
 * Settings are user content and an archive may restore them, so this is a
 * parser: unknown nutrient codes are dropped, non-finite values fall back to
 * the default, and percentages are clamped to a range the UI can explain.
 */
export function normalizeTargetRules(raw: unknown): TargetRules {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fraction = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const amberOver = fraction(input.amberOver, DEFAULT_TARGET_RULES.amberOver, 0, 1);
  const redAt = Math.max(
    amberOver,
    fraction(input.redAt, DEFAULT_TARGET_RULES.redAt, 0, 2),
  );
  const tolerance = fraction(input.tolerance, DEFAULT_TARGET_RULES.tolerance, 0, 0.5);
  const sugarTolerance = fraction(
    input.sugarTolerance,
    DEFAULT_TARGET_RULES.sugarTolerance,
    0,
    0.5,
  );

  const overrides: Partial<Record<NutrientCode, number>> = {};
  const rawOverrides =
    input.overrides && typeof input.overrides === "object"
      ? (input.overrides as Record<string, unknown>)
      : {};
  for (const [code, value] of Object.entries(rawOverrides)) {
    if (!(NUTRIENT_CODES as readonly string[]).includes(code)) continue;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_TARGET_OVERRIDE) continue;
    overrides[code as NutrientCode] = n;
  }

  return { amberOver, redAt, tolerance, sugarTolerance, overrides };
}

export function isDefaultTargetRules(rules: TargetRules): boolean {
  return (
    rules.amberOver === DEFAULT_TARGET_RULES.amberOver &&
    rules.redAt === DEFAULT_TARGET_RULES.redAt &&
    rules.tolerance === DEFAULT_TARGET_RULES.tolerance &&
    rules.sugarTolerance === DEFAULT_TARGET_RULES.sugarTolerance &&
    Object.keys(rules.overrides).length === 0
  );
}

export interface Target {
  code: NutrientCode;
  /** Reference amount for one day. */
  value: number;
  direction: "min" | "max";
  period: "day";
  role: GuidanceRole;
  /** How far from the reference still counts as on target, as a fraction. */
  tolerance: number;
  /** Fraction over target where the bar turns amber. */
  amberOver: number;
  /** Fraction over target where the bar turns red. */
  redAt: number;
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

/**
 * Build the daily target set for a profile.
 *
 * Direction comes from the nutrient vocabulary, so a nutrient cannot be a
 * limit in one screen and a minimum in another. The role comes from the
 * table above for the same reason.
 *
 * `rules` are the user's status thresholds and optional per-nutrient
 * overrides. The profile still supplies the recommended value, so clearing
 * an override returns to the recommendation rather than to a hardcoded
 * number.
 */
export function targetsFor(profile: Profile, rules: TargetRules = DEFAULT_TARGET_RULES): Target[] {
  const breakdown = energyBreakdown(profile);
  const normalized = normalizeTargetRules(rules);

  // The override is the energy the person is aiming at, so the macros that
  // are derived from energy follow it too — not the formula they overrode.
  const energy = profile.targetEnergyKcal ?? breakdown.target;
  const macros = energyMacros(energy, breakdown.protein);

  const values: Record<NutrientCode, number> = {
    ENERC_KCAL: energy,
    PROCNT: breakdown.protein,
    FAT: macros.fat,
    CHOCDF: macros.carbs,
    FIBTG: macros.fibre,
    SUGAR: macros.sugar,
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
    value: normalized.overrides[code] ?? values[code],
    direction: NUTRIENTS[code].direction,
    period: "day" as const,
    role: ROLE_BY_CODE[code],
    // Sugar keeps its own, wider default because label values are less
    // precise; every other nutrient follows the general tolerance.
    tolerance: code === "SUGAR" ? normalized.sugarTolerance : normalized.tolerance,
    amberOver: normalized.amberOver,
    redAt: normalized.redAt,
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
  /** Fractions over target where the bar turns amber and red. */
  amberOver: number;
  redAt: number;
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
        amberOver: target.amberOver,
        redAt: target.redAt,
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
      amberOver: target.amberOver,
      redAt: target.redAt,
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
        amberOver: target.amberOver,
        redAt: target.redAt,
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
      amberOver: target.amberOver,
      redAt: target.redAt,
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
