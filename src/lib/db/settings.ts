import { db } from "./client";
import {
  DEFAULT_TARGET_RULES,
  normalizeTargetRules,
  type TargetRules,
} from "@/lib/targets";

/**
 * Global, user-editable instructions injected into every AI call the app
 * makes (recipe planning, nutrient estimation). This is where "I cook South
 * Indian home food, prefer IFCT values, flag what you are unsure of" lives.
 */
export const DEFAULT_MASTER_PROMPT =
  "Prefer sources specific to the region and cuisine of the food. Where you lack specific evidence for a value, omit it rather than invent it.";

export function getMasterPrompt(): string {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = 'ai_master_prompt'")
    .get() as unknown as { value: string } | undefined;
  return row?.value ?? DEFAULT_MASTER_PROMPT;
}

export function setMasterPrompt(value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('ai_master_prompt', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(value);
}

export function resetMasterPrompt(): void {
  db.prepare("DELETE FROM app_settings WHERE key = 'ai_master_prompt'").run();
}

/**
 * Status thresholds and per-nutrient overrides.
 *
 * Stored as one JSON setting so a half-written pair of percentages cannot
 * exist. Reading runs the same parser as an archive import, which means a
 * hand-edited database row, a restored archive and a submitted form all go
 * through one set of rules.
 */
const TARGET_RULES_KEY = "target_rules";

export function getTargetRules(): TargetRules {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(TARGET_RULES_KEY) as unknown as { value: string } | undefined;
  if (!row) return DEFAULT_TARGET_RULES;

  try {
    return normalizeTargetRules(JSON.parse(row.value));
  } catch {
    // A corrupted row must not take the diary down; fall back to the
    // documented defaults and leave the row for the user to overwrite.
    return DEFAULT_TARGET_RULES;
  }
}

export function setTargetRules(rules: unknown): TargetRules {
  const normalized = normalizeTargetRules(rules);
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(TARGET_RULES_KEY, JSON.stringify(normalized));
  return normalized;
}

export function resetTargetRules(): void {
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(TARGET_RULES_KEY);
}
