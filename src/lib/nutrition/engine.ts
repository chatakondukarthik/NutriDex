import {
  NUTRIENT_CODES,
  type NutrientCode,
  type NutrientProfile,
  type NutrientStatus,
} from "./types";

/** A profile with every nutrient explicitly unknown. */
export function emptyProfile(source = "none"): NutrientProfile {
  const profile = {} as NutrientProfile;
  for (const code of NUTRIENT_CODES) {
    profile[code] = { amount: null, status: "unknown", source };
  }
  return profile;
}

/**
 * Build a profile from a sparse map of amounts.
 * Anything omitted is `unknown`, which is the honest default.
 */
export function makeProfile(
  amounts: Partial<Record<NutrientCode, number | null>>,
  source: string,
  sourceFoodCode?: string,
): NutrientProfile {
  const profile = emptyProfile(source);
  for (const code of NUTRIENT_CODES) {
    const amount = amounts[code];
    if (amount == null) continue;
    profile[code] = {
      amount,
      status: "known",
      source,
      sourceFoodCode,
    };
  }
  return profile;
}

/** Scale a per-100 g profile to an arbitrary gram weight. */
export function scaleProfile(profile: NutrientProfile, grams: number): NutrientProfile {
  const factor = grams / 100;
  const scaled = {} as NutrientProfile;
  for (const code of NUTRIENT_CODES) {
    const value = profile[code];
    scaled[code] = {
      ...value,
      amount: value.amount == null ? null : value.amount * factor,
    };
  }
  return scaled;
}

export interface Contribution {
  /** Human label, for the coverage explanation. */
  label: string;
  profile: NutrientProfile;
  grams: number;
}

export interface NutrientCoverage {
  known: number;
  total: number;
}

export interface Rollup {
  /** Sum of the known values. A lower bound when coverage is partial. */
  totals: Record<NutrientCode, number | null>;
  status: Record<NutrientCode, NutrientStatus>;
  coverage: Record<NutrientCode, NutrientCoverage>;
}

/**
 * Sum contributions.
 *
 * Missing values are never treated as zero. If three of eight
 * ingredients know their iron value, the total is the sum of those
 * three, flagged `estimated` with coverage 3/8 — a lower bound the user
 * can see through.
 */
export function rollup(contributions: Contribution[]): Rollup {
  const totals = {} as Record<NutrientCode, number | null>;
  const status = {} as Record<NutrientCode, NutrientStatus>;
  const coverage = {} as Record<NutrientCode, NutrientCoverage>;

  for (const code of NUTRIENT_CODES) {
    let sum = 0;
    let known = 0;

    for (const contribution of contributions) {
      const value = contribution.profile[code];
      if (value.amount == null) continue;
      sum += value.amount * (contribution.grams / 100);
      known += 1;
    }

    const total = contributions.length;
    totals[code] = known === 0 ? null : sum;
    coverage[code] = { known, total };
    status[code] = known === 0 ? "unknown" : known === total ? "known" : "estimated";
  }

  return { totals, status, coverage };
}

/** Divide a rollup by a serving count, preserving status and coverage. */
export function perServing(result: Rollup, servings: number): Rollup {
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new Error("Servings must be a positive number.");
  }
  const totals = {} as Record<NutrientCode, number | null>;
  for (const code of NUTRIENT_CODES) {
    const value = result.totals[code];
    totals[code] = value == null ? null : value / servings;
  }
  return { totals, status: result.status, coverage: result.coverage };
}

/**
 * Energy from macros, using Atwater factors.
 *
 * Used as a sanity check, never as the source of truth: the reference
 * table's own energy value wins. Generic factors cannot match every food
 * exactly — USDA itself uses food-group-specific factors, and the method
 * differs per table — so treat a drift over ~20% as a signal that an
 * ingredient was resolved to the wrong record, not as an accuracy score.
 *
 * Fibre is counted at 2 kcal/g and removed from carbohydrate, which is
 * the convention most composition tables use. Skipping this makes
 * high-fibre foods look 5–30% too energetic.
 */
export function atwaterKcal(profile: NutrientProfile): number | null {
  const protein = profile.PROCNT.amount;
  const fat = profile.FAT.amount;
  const carb = profile.CHOCDF.amount;
  if (protein == null || fat == null || carb == null) return null;

  const fibre = profile.FIBTG.amount;
  if (fibre == null) {
    return protein * 4 + fat * 9 + carb * 4;
  }

  const availableCarb = Math.max(0, carb - fibre);
  return protein * 4 + fat * 9 + availableCarb * 4 + fibre * 2;
}

export function energyDriftPercent(profile: NutrientProfile): number | null {
  const stated = profile.ENERC_KCAL.amount;
  const computed = atwaterKcal(profile);
  if (stated == null || computed == null || stated === 0) return null;
  return ((computed - stated) / stated) * 100;
}

/** 0–1 fraction of tracked nutrients that have a known value. */
export function completeness(profile: NutrientProfile): number {
  const known = NUTRIENT_CODES.filter((c) => profile[c].amount != null).length;
  return known / NUTRIENT_CODES.length;
}
