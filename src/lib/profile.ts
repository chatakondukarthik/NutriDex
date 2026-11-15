/**
 * The person the targets are for.
 *
 * Deliberately small: enough to compute an energy figure and to pick the
 * right reference row for iron and calcium, and nothing more. Weight is
 * asked for because protein and energy both scale with it; height because
 * the energy equation needs it. Body fat is optional: when it is present,
 * the lean-mass equation is a better estimate than a height/weight one.
 *
 * There is one implicit local profile until accounts exist (S4).
 */

export type Sex = "female" | "male";

export type Activity = "sedentary" | "light" | "moderate" | "active";

export type Goal = "lose" | "maintain" | "gain";

/** How fast the user wants to move toward the goal. */
export type Pace = "gentle" | "steady" | "fast";

export interface Profile {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: Goal;
  /** Optional. Used by Katch–McArdle when present. */
  bodyFatPercent: number | null;
  /** Only used when losing or gaining. */
  pace: Pace;
  /** Optional. Used for the time-to-goal projection only. */
  targetWeightKg: number | null;
  /** Optional override for the daily energy target, in kcal. */
  targetEnergyKcal: number | null;
}

/**
 * A neutral starting point, not a recommendation. The plan screen says
 * these are defaults until the user edits them, so nothing here should
 * look like it was chosen for them.
 */
export const DEFAULT_PROFILE: Profile = {
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

export const ACTIVITY_LABELS: Record<Activity, string> = {
  sedentary: "Sedentary — desk work, little exercise",
  light: "Light — exercise 1–3 days a week",
  moderate: "Moderate — exercise 3–5 days a week",
  active: "Active — physical job or daily training",
};

export const GOAL_LABELS: Record<Goal, string> = {
  lose: "Lose fat",
  maintain: "Maintain",
  gain: "Gain muscle",
};

export const PACE_LABELS: Record<Pace, string> = {
  gentle: "Gentle",
  steady: "Steady",
  fast: "Fast",
};

/** Physical activity level multipliers applied to BMR. */
export const PAL: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

/**
 * Weight-change pace as a fraction of body weight per week.
 *
 * Loss: 0.25 / 0.5 / 0.75 % of body weight per week. The 0.5–1 %/week band
 * is the usual guidance for sustainable fat loss; the gentle option sits
 * below it on purpose.
 *
 * Gain: 0.125 / 0.25 / 0.5 % per week. Muscle gain is slower than fat
 * loss, and a smaller surplus limits unnecessary fat gain.
 *
 * Stored as a pace, not a kg figure, so the rate follows the current
 * weight instead of going stale.
 */
const PACE_FRACTION: Record<Goal, Record<Pace, number>> = {
  lose: { gentle: 0.0025, steady: 0.005, fast: 0.0075 },
  gain: { gentle: 0.00125, steady: 0.0025, fast: 0.005 },
  maintain: { gentle: 0, steady: 0, fast: 0 },
};

/** Energy in a kilogram of body mass, used for the deficit/surplus. */
const KCAL_PER_KG = 7700;

export function leanBodyMassKg(profile: Profile): number | null {
  if (profile.bodyFatPercent == null) return null;
  return profile.weightKg * (1 - profile.bodyFatPercent / 100);
}

export type BmrSource = "mifflin" | "katch";

/**
 * Basal metabolic rate.
 *
 * Mifflin–St Jeor is the default because it is the equation most current
 * dietetic practice uses and it needs only what we ask for. When body fat
 * is known, Katch–McArdle uses lean mass and is less wrong for people
 * whose weight is mostly fat or mostly muscle.
 */
export function bmr(profile: Profile): number {
  const lbm = leanBodyMassKg(profile);
  if (lbm != null) return 370 + 21.6 * lbm;

  const base =
    10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears;
  return base + (profile.sex === "male" ? 5 : -161);
}

export function bmrSource(profile: Profile): BmrSource {
  return leanBodyMassKg(profile) == null ? "mifflin" : "katch";
}

export function bmrFormula(profile: Profile): string {
  const lbm = leanBodyMassKg(profile);
  if (lbm != null) {
    return `370 + 21.6 × ${round(lbm, 1)} kg lean mass`;
  }
  return `10 × ${round(profile.weightKg, 1)} + 6.25 × ${round(profile.heightCm, 1)} − 5 × ${profile.ageYears} ${
    profile.sex === "male" ? "+ 5" : "− 161"
  }`;
}

/**
 * Maintenance energy: BMR × activity.
 *
 * This is the energy the person would burn at their current weight. The
 * goal adjustment is applied separately so the UI can show it as its own
 * line rather than hiding it inside one number.
 */
export function maintenanceKcal(profile: Profile): number {
  return bmr(profile) * PAL[profile.activity];
}

/** The pace as a signed kg/week figure for the current body weight. */
export function paceRateKgPerWeek(profile: Profile): number {
  if (profile.goal === "maintain") return 0;
  return roundTo(profile.weightKg * PACE_FRACTION[profile.goal][profile.pace], 0.05);
}

/** The pace as a percentage of body weight per week, for display. */
export function pacePercentPerWeek(profile: Profile): number {
  if (profile.goal === "maintain") return 0;
  return PACE_FRACTION[profile.goal][profile.pace] * 100;
}

export type EnergyCap = "floor" | "deficit" | "surplus" | null;

export interface EnergyBreakdown {
  bmr: number;
  bmrSource: BmrSource;
  bmrFormula: string;
  activity: Activity;
  activityMultiplier: number;
  maintenance: number;
  goal: Goal;
  pace: Pace;
  rateKgPerWeek: number;
  ratePercentPerWeek: number;
  /** The rate actually implied by `delta`, after the safety rails. */
  effectiveRateKgPerWeek: number;
  effectivePercentPerWeek: number;
  /** The adjustment the pace asks for, before safety rails. */
  plannedDelta: number;
  /** The adjustment actually applied after the rails. */
  delta: number;
  cap: EnergyCap;
  floor: number;
  target: number;
  proteinPerKg: number;
  protein: number;
  fat: number;
  carbs: number;
  fibre: number;
  sugar: number;
}

/**
 * Everything the energy target is made of, in one place.
 *
 * The UI renders this directly, so the explanation cannot drift from the
 * number. The safety rails are deliberate:
 *
 * - never below 1200 kcal (female) / 1500 kcal (male);
 * - never a deficit above 25 % of maintenance;
 * - never a surplus above 15 % of maintenance.
 *
 * They are guard rails, not prescriptions. The panel says when one bites.
 */
export function energyBreakdown(profile: Profile): EnergyBreakdown {
  const basal = bmr(profile);
  const multiplier = PAL[profile.activity];
  const maintenance = basal * multiplier;
  const rateKgPerWeek = paceRateKgPerWeek(profile);
  const ratePercentPerWeek = pacePercentPerWeek(profile);

  // `paceRateKgPerWeek` is a magnitude; the goal decides the direction.
  const direction =
    profile.goal === "lose" ? -1 : profile.goal === "gain" ? 1 : 0;
  const plannedDelta =
    direction === 0 ? 0 : direction * ((rateKgPerWeek * KCAL_PER_KG) / 7);

  let delta = plannedDelta;
  let cap: EnergyCap = null;

  if (profile.goal === "lose") {
    const maxDeficit = maintenance * 0.25;
    if (Math.abs(plannedDelta) > maxDeficit) {
      delta = -maxDeficit;
      cap = "deficit";
    }
  } else if (profile.goal === "gain") {
    const maxSurplus = maintenance * 0.15;
    if (plannedDelta > maxSurplus) {
      delta = maxSurplus;
      cap = "surplus";
    }
  }

  const floor = profile.sex === "male" ? 1500 : 1200;
  let target = roundTo(maintenance + delta, 10);

  if (target < floor) {
    target = floor;
    delta = floor - maintenance;
    cap = "floor";
  }

  // What the applied adjustment actually means. A capped pace loses less
  // than the option promises, so the UI has to say so with this number
  // rather than repeating the requested one.
  const effectiveRateKgPerWeek =
    profile.goal === "maintain"
      ? 0
      : roundTo((Math.abs(delta) * 7) / KCAL_PER_KG, 0.01);
  const effectivePercentPerWeek =
    profile.goal === "maintain"
      ? 0
      : roundTo((effectiveRateKgPerWeek / profile.weightKg) * 100, 0.01);

  const proteinPerKg = profile.goal === "lose" ? 1.2 : profile.goal === "gain" ? 1.4 : 1.0;
  const protein = roundTo(profile.weightKg * proteinPerKg, 5);

  // Fat at 30 % of energy is a ceiling, not a goal: it is the top of the
  // acceptable range, so the bar going amber means something.
  const fat = roundTo((target * 0.3) / 9, 5);

  // Carbohydrate is whatever energy is left once protein and fat are
  // accounted for. Presenting it as a minimum keeps the bars readable;
  // it is not an independent recommendation.
  const carbs = Math.max(50, roundTo((target - protein * 4 - fat * 9) / 4, 5));

  // 14 g per 1000 kcal is the usual fibre guidance, applied to the
  // computed energy rather than a fixed adult figure.
  const fibre = roundTo((target / 1000) * 14, 1);

  // Free sugars should stay under 10 % of energy. Our SUGAR field is total
  // sugars, so this is a stricter reading of the same limit — worth
  // knowing, and documented rather than hidden.
  const sugar = roundTo((target * 0.1) / 4, 5);

  return {
    bmr: basal,
    bmrSource: bmrSource(profile),
    bmrFormula: bmrFormula(profile),
    activity: profile.activity,
    activityMultiplier: multiplier,
    maintenance,
    goal: profile.goal,
    pace: profile.pace,
    rateKgPerWeek,
    ratePercentPerWeek,
    effectiveRateKgPerWeek,
    effectivePercentPerWeek,
    plannedDelta,
    delta,
    cap,
    floor,
    target,
    proteinPerKg,
    protein,
    fat,
    carbs,
    fibre,
    sugar,
  };
}

export function dailyEnergyKcal(profile: Profile): number {
  return energyBreakdown(profile).target;
}

/** Protein per kg of body weight, by goal. */
export function proteinGrams(profile: Profile): number {
  return energyBreakdown(profile).protein;
}

/**
 * How many weeks the current pace needs to reach the optional target
 * weight. Null when the target is absent, the goal is maintenance, or the
 * target is on the wrong side of the current weight.
 */
export function projectionWeeks(profile: Profile): number | null {
  if (profile.targetWeightKg == null) return null;

  // The projection uses the rate that is actually applied, not the one the
  // pace asks for: a capped deficit reaches the target later, and saying
  // otherwise would make the estimate wrong in the optimistic direction.
  const rate = energyBreakdown(profile).effectiveRateKgPerWeek;
  if (rate <= 0) return null;

  const direction = profile.goal === "lose" ? -1 : profile.goal === "gain" ? 1 : 0;
  if (direction === 0) return null;

  const diff = profile.targetWeightKg - profile.weightKg;
  if (Math.sign(diff) !== direction) return null;

  return Math.ceil(Math.abs(diff) / rate);
}

/** True when the profile is still the neutral placeholder. */
export function isDefaultProfile(profile: Profile): boolean {
  return (Object.keys(DEFAULT_PROFILE) as (keyof Profile)[]).every(
    (key) => profile[key] === DEFAULT_PROFILE[key],
  );
}

/**
 * Validate untrusted input from the profile form.
 *
 * Returns the profile or the first reason it is unusable. The form is the
 * only place these numbers enter the system, so this is the only place
 * they need checking.
 */
export function parseProfile(
  input: unknown,
): { ok: true; profile: Profile } | { ok: false; message: string } {
  if (typeof input !== "object" || input == null) {
    return { ok: false, message: "Profile is missing." };
  }
  const raw = input as Record<string, unknown>;

  const sex = raw.sex;
  if (sex !== "female" && sex !== "male") {
    return { ok: false, message: "Choose a sex." };
  }

  const ageYears = Number(raw.ageYears);
  if (!Number.isFinite(ageYears) || ageYears < 13 || ageYears > 100) {
    return { ok: false, message: "Age must be between 13 and 100." };
  }

  const heightCm = Number(raw.heightCm);
  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250) {
    return { ok: false, message: "Height must be between 100 and 250 cm." };
  }

  const weightKg = Number(raw.weightKg);
  if (!Number.isFinite(weightKg) || weightKg < 25 || weightKg > 300) {
    return { ok: false, message: "Weight must be between 25 and 300 kg." };
  }

  const activity = raw.activity;
  if (!isActivity(activity)) {
    return { ok: false, message: "Choose an activity level." };
  }

  const goal = raw.goal;
  if (goal !== "lose" && goal !== "maintain" && goal !== "gain") {
    return { ok: false, message: "Choose a goal." };
  }

  const bodyFat = optionalNumber(raw.bodyFatPercent, 3, 70, "Body fat");
  if (!bodyFat.ok) return bodyFat;

  const targetWeight = optionalNumber(raw.targetWeightKg, 25, 300, "Target weight");
  if (!targetWeight.ok) return targetWeight;

  const targetEnergy = optionalNumber(raw.targetEnergyKcal, 800, 6000, "Energy target");
  if (!targetEnergy.ok) return targetEnergy;

  const pace = raw.pace == null || raw.pace === "" ? "steady" : raw.pace;
  if (!isPace(pace)) {
    return { ok: false, message: "Choose a pace." };
  }

  return {
    ok: true,
    profile: {
      sex,
      ageYears,
      heightCm,
      weightKg,
      activity,
      goal,
      bodyFatPercent: bodyFat.value,
      pace,
      targetWeightKg: targetWeight.value,
      targetEnergyKcal: targetEnergy.value,
    },
  };
}

function optionalNumber(
  value: unknown,
  min: number,
  max: number,
  label: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value == null || value === "") return { ok: true, value: null };
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    return { ok: false, message: `${label} must be between ${min} and ${max}.` };
  }
  return { ok: true, value: number };
}

function isActivity(value: unknown): value is Activity {
  return value === "sedentary" || value === "light" || value === "moderate" || value === "active";
}

function isPace(value: unknown): value is Pace {
  return value === "gentle" || value === "steady" || value === "fast";
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function roundTo(value: number, step: number): number {
  // `toFixed` removes binary floating-point noise such as 0.15000000000000002,
  // which would otherwise leak into the UI and the projection maths.
  return Number((Math.round(value / step) * step).toFixed(6));
}
