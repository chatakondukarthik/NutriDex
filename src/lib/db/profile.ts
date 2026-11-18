import { db } from "./client";
import {
  DEFAULT_PROFILE,
  parseProfile,
  type Activity,
  type Goal,
  type Pace,
  type Profile,
  type Sex,
} from "@/lib/profile";

/**
 * The body profile, stored per person.
 *
 * `profile.id` is the person id from `people`. A person may exist without a
 * row; the diary then uses `DEFAULT_PROFILE` until they fill the form in.
 */

interface Row {
  sex: string;
  age_years: number;
  height_cm: number;
  weight_kg: number;
  activity: string;
  goal: string;
  body_fat_percent: number | null;
  pace: string | null;
  target_weight_kg: number | null;
  target_energy_kcal: number | null;
}

const SELECT = `SELECT sex, age_years, height_cm, weight_kg, activity, goal,
                       body_fat_percent, pace, target_weight_kg, target_energy_kcal
                FROM profile WHERE id = ?`;

export function getProfile(personId: string): Profile {
  const row = db.prepare(SELECT).get(personId) as unknown as Row | undefined;

  if (!row) return DEFAULT_PROFILE;

  // A stored row can only be wrong if it was written before a validation
  // change. Fall back to the default rather than serving nonsense.
  const parsed = parseProfile({
    sex: row.sex as Sex,
    ageYears: row.age_years,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    activity: row.activity as Activity,
    goal: row.goal as Goal,
    bodyFatPercent: row.body_fat_percent,
    pace: (row.pace as Pace | null) ?? "steady",
    targetWeightKg: row.target_weight_kg,
    targetEnergyKcal: row.target_energy_kcal,
  });

  return parsed.ok ? parsed.profile : DEFAULT_PROFILE;
}

export function saveProfile(personId: string, profile: Profile): void {
  db.prepare(
    `INSERT INTO profile
       (id, sex, age_years, height_cm, weight_kg, activity, goal,
        body_fat_percent, pace, target_weight_kg, target_energy_kcal, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       sex = excluded.sex,
       age_years = excluded.age_years,
       height_cm = excluded.height_cm,
       weight_kg = excluded.weight_kg,
       activity = excluded.activity,
       goal = excluded.goal,
       body_fat_percent = excluded.body_fat_percent,
       pace = excluded.pace,
       target_weight_kg = excluded.target_weight_kg,
       target_energy_kcal = excluded.target_energy_kcal,
       updated_at = excluded.updated_at`,
  ).run(
    personId,
    profile.sex,
    profile.ageYears,
    profile.heightCm,
    profile.weightKg,
    profile.activity,
    profile.goal,
    profile.bodyFatPercent,
    profile.pace,
    profile.targetWeightKg,
    profile.targetEnergyKcal,
    new Date().toISOString(),
  );
}

export function deleteProfile(personId: string): void {
  db.prepare("DELETE FROM profile WHERE id = ?").run(personId);
}

export function hasProfile(personId: string): boolean {
  return Boolean(db.prepare("SELECT 1 AS present FROM profile WHERE id = ?").get(personId));
}
