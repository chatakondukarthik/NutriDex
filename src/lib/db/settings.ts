import { db } from "./client";

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
