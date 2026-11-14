import { NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";
import {
  dailyEnergyKcal,
  proteinGrams,
  type Profile,
} from "@/lib/profile";

/**
 * Daily targets.
 *
 * Derived from a profile rather than hardcoded, so the diary and the plan
 * share one source of truth and changing the profile moves both.
 *
 * The shape is the contract the target engine will keep:
 *
 *   { nutrient, direction, value, period }
 *
 * **Where the numbers come from.** Energy and protein are computed from
 * the profile (Mifflin–St Jeor, activity level, goal, g/kg). Fat, sugar,
 * fibre and carbohydrate are derived from energy. Minerals and vitamins
 * are seed values from the ICMR–NIN 2020 Recommended Dietary Allowances
 * for Indians, banded by sex and age.
 *
 * **What that means.** They are reference values for a population, not a
 * prescription for a person, and they have not been through a verified
 * review. Q-003 in `docs/research/RESEARCH.md` is still open: one value
 * per nutrient versus a range, and whether a `max` is a limit or a goal.
 * The UI therefore shows them as targets to aim at, never as a pass/fail.
 */

export interface Target {
  code: NutrientCode;
  value: number;
  direction: "min" | "max";
  period: "day";
}

/**
 * Build the daily target set for a profile.
 *
 * Direction comes from the nutrient vocabulary, so a nutrient cannot be a
 * limit in one screen and a minimum in another.
 */
export function targetsFor(profile: Profile): Target[] {
  const energy = dailyEnergyKcal(profile);
  const protein = proteinGrams(profile);

  // Fat at 30% of energy is a ceiling, not a goal: it is the top of the
  // acceptable range, so the bar going amber means something.
  const fat = roundTo((energy * 0.3) / 9, 5);

  // Carbohydrate is whatever energy is left once protein and fat are
  // accounted for. Presenting it as a minimum keeps the bars readable;
  // it is not an independent recommendation.
  const carbs = Math.max(50, roundTo((energy - protein * 4 - fat * 9) / 4, 5));

  // 14 g per 1000 kcal is the usual fibre guidance, applied to the
  // computed energy rather than a fixed adult figure.
  const fibre = roundTo((energy / 1000) * 14, 1);

  // Free sugars should stay under 10% of energy. Our SUGAR field is total
  // sugars, so this is a stricter reading of the same limit — worth
  // knowing, and documented rather than hidden.
  const sugar = roundTo((energy * 0.1) / 4, 5);

  const female = profile.sex === "female";
  const older = profile.ageYears >= 51;

  const values: Record<NutrientCode, number> = {
    ENERC_KCAL: energy,
    PROCNT: protein,
    FAT: fat,
    CHOCDF: carbs,
    FIBTG: fibre,
    SUGAR: sugar,
    NA: 2000,
    K: 3500,
    CA: older ? 1200 : 1000,
    // Iron is the clearest sex-specific value, and the one most likely to
    // be wrong for an individual. Menstruating women need substantially
    // more than men.
    FE: female && !older ? 29 : 19,
    ZN: female ? 13 : 17,
    MG: female ? 370 : 440,
    VITA_RAE: female ? 840 : 1000,
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
  }));
}

export function targetMap(targets: Target[]): Map<NutrientCode, Target> {
  return new Map(targets.map((target) => [target.code, target]));
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
