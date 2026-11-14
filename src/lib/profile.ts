/**
 * The person the targets are for.
 *
 * Deliberately small: enough to compute an energy figure and to pick the
 * right reference row for iron and calcium, and nothing more. Weight is
 * asked for because protein and energy both scale with it; height because
 * the energy equation needs it.
 *
 * There is one implicit local profile until accounts exist (S4).
 */

export type Sex = "female" | "male";

export type Activity = "sedentary" | "light" | "moderate" | "active";

export type Goal = "lose" | "maintain" | "gain";

export interface Profile {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: Goal;
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

/** Physical activity level multipliers applied to BMR. */
const PAL: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

/**
 * Basal metabolic rate, Mifflin–St Jeor.
 *
 * Chosen over Harris–Benedict because it is the equation most current
 * dietetic practice uses and it needs only what we ask for.
 */
export function bmr(profile: Profile): number {
  const base =
    10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears;
  return base + (profile.sex === "male" ? 5 : -161);
}

/**
 * Maintenance energy: BMR × activity, with a goal adjustment.
 *
 * The adjustment is a round number, not a promise. Real weight change is
 * slow and noisy; the product presents this as a starting point to adjust
 * against what actually happens.
 */
export function maintenanceKcal(profile: Profile): number {
  return bmr(profile) * PAL[profile.activity];
}

export function dailyEnergyKcal(profile: Profile): number {
  const delta = profile.goal === "lose" ? -400 : profile.goal === "gain" ? 300 : 0;
  const floor = profile.sex === "male" ? 1500 : 1200;
  return roundTo(Math.max(floor, maintenanceKcal(profile) + delta), 10);
}

/** Protein per kg of body weight, by goal. */
export function proteinGrams(profile: Profile): number {
  const perKg = profile.goal === "lose" ? 1.2 : profile.goal === "gain" ? 1.4 : 1.0;
  return roundTo(profile.weightKg * perKg, 5);
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
export function parseProfile(input: unknown): { ok: true; profile: Profile } | { ok: false; message: string } {
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

  return {
    ok: true,
    profile: { sex, ageYears, heightCm, weightKg, activity, goal },
  };
}

function isActivity(value: unknown): value is Activity {
  return value === "sedentary" || value === "light" || value === "moderate" || value === "active";
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
