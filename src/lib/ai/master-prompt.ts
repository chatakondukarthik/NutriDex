/**
 * Pure, dependency-free default for the global AI instructions.
 *
 * This constant is imported by both server code (db/settings) and client
 * components (the settings panel), so it must not pull in the database —
 * a client bundle containing node:sqlite is rejected outright.
 */
export const DEFAULT_MASTER_PROMPT =
  "Prefer sources specific to the region and cuisine of the food. Where you lack specific evidence for a value, omit it rather than invent it.";
