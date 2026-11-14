import { db } from "./client";
import { DEFAULT_PROFILE, parseProfile, type Profile } from "@/lib/profile";

/**
 * The profile, stored as a single local row.
 *
 * Accounts arrive in S4; until then there is exactly one person using the
 * app, and pretending otherwise would add a user table that has one row.
 */

const LOCAL_ID = "local";

interface Row {
  sex: string;
  age_years: number;
  height_cm: number;
  weight_kg: number;
  activity: string;
  goal: string;
}

export function getProfile(): Profile {
  const row = db
    .prepare("SELECT sex, age_years, height_cm, weight_kg, activity, goal FROM profile WHERE id = ?")
    .get(LOCAL_ID) as unknown as Row | undefined;

  if (!row) return DEFAULT_PROFILE;

  // A stored row can only be wrong if it was written before a validation
  // change. Fall back to the default rather than serving nonsense.
  const parsed = parseProfile({
    sex: row.sex,
    ageYears: row.age_years,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    activity: row.activity,
    goal: row.goal,
  });

  return parsed.ok ? parsed.profile : DEFAULT_PROFILE;
}

export function saveProfile(profile: Profile): void {
  db.prepare(
    `INSERT INTO profile (id, sex, age_years, height_cm, weight_kg, activity, goal, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       sex = excluded.sex,
       age_years = excluded.age_years,
       height_cm = excluded.height_cm,
       weight_kg = excluded.weight_kg,
       activity = excluded.activity,
       goal = excluded.goal,
       updated_at = excluded.updated_at`,
  ).run(
    LOCAL_ID,
    profile.sex,
    profile.ageYears,
    profile.heightCm,
    profile.weightKg,
    profile.activity,
    profile.goal,
    new Date().toISOString(),
  );
}
