/**
 * Seed retention factors.
 *
 * Source: USDA Table of Nutrient Retention Factors, Release 6 (2007),
 * public domain. These are UNVERIFIED fixtures pending review against the
 * published tables — same status as the seed foods. A factor is the
 * fraction of a nutrient retained by the operation; 1 = no change.
 *
 * Where the published tables differ by food, we use the conservative
 * middle of the range. LLM estimates fill the gaps (tagged `estimated`).
 */
export interface SeedFactor {
  operation: string;
  qualifier: string | null;
  nutrient: string;
  factor: number;
  source: string;
}

export const SEED_FACTORS: SeedFactor[] = [
  // ---- boil, undrained (water retained) ----
  { operation: "boil", qualifier: "undrained", nutrient: "VITC", factor: 0.9, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "undrained", nutrient: "VITB6", factor: 0.95, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "undrained", nutrient: "FOL", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "undrained", nutrient: "VITA_RAE", factor: 0.9, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "undrained", nutrient: "NA", factor: 0.9, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "undrained", nutrient: "K", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  // ---- boil, drained (water discarded) ----
  { operation: "boil", qualifier: "drained", nutrient: "VITC", factor: 0.5, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "drained", nutrient: "VITB6", factor: 0.6, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "drained", nutrient: "FOL", factor: 0.45, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "drained", nutrient: "VITA_RAE", factor: 0.75, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "drained", nutrient: "NA", factor: 0.65, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "drained", nutrient: "K", factor: 0.6, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "drained", nutrient: "CA", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "drained", nutrient: "FE", factor: 0.8, source: "usda-r6 (seed, unverified)" },
  { operation: "boil", qualifier: "drained", nutrient: "MG", factor: 0.75, source: "usda-r6 (seed, unverified)" },
  // ---- strain (equivalent to a drain) ----
  { operation: "strain", qualifier: "drained", nutrient: "VITC", factor: 0.55, source: "usda-r6 (seed, unverified)" },
  { operation: "strain", qualifier: "drained", nutrient: "FOL", factor: 0.5, source: "usda-r6 (seed, unverified)" },
  { operation: "strain", qualifier: "drained", nutrient: "VITB12", factor: 0.7, source: "usda-r6 (seed, unverified)" },
  // ---- sauté / fry / deep fry ----
  { operation: "sauté", qualifier: null, nutrient: "VITC", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  { operation: "sauté", qualifier: null, nutrient: "FOL", factor: 0.8, source: "usda-r6 (seed, unverified)" },
  { operation: "fry", qualifier: null, nutrient: "VITC", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  { operation: "fry", qualifier: null, nutrient: "FOL", factor: 0.8, source: "usda-r6 (seed, unverified)" },
  { operation: "fry", qualifier: null, nutrient: "VITA_RAE", factor: 0.9, source: "usda-r6 (seed, unverified)" },
  { operation: "deep-fry", qualifier: null, nutrient: "VITC", factor: 0.8, source: "usda-r6 (seed, unverified)" },
  // ---- roast / bake / grill ----
  { operation: "roast", qualifier: null, nutrient: "VITC", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  { operation: "roast", qualifier: null, nutrient: "FOL", factor: 0.75, source: "usda-r6 (seed, unverified)" },
  { operation: "roast", qualifier: null, nutrient: "VITA_RAE", factor: 0.9, source: "usda-r6 (seed, unverified)" },
  { operation: "bake", qualifier: null, nutrient: "VITC", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  { operation: "grill", qualifier: null, nutrient: "VITC", factor: 0.8, source: "usda-r6 (seed, unverified)" },
  { operation: "grill", qualifier: null, nutrient: "VITA_RAE", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  // ---- pressure cook ----
  { operation: "pressure-cook", qualifier: "undrained", nutrient: "VITC", factor: 0.85, source: "usda-r6 (seed, unverified)" },
  { operation: "pressure-cook", qualifier: "undrained", nutrient: "FOL", factor: 0.8, source: "usda-r6 (seed, unverified)" },
  // ---- aromatics (negligible change to mass; vitamins heat-labile) ----
  { operation: "sauté", qualifier: null, nutrient: "VITB6", factor: 0.9, source: "usda-r6 (seed, unverified)" },
  { operation: "fry", qualifier: null, nutrient: "VITB6", factor: 0.9, source: "usda-r6 (seed, unverified)" },
  // ---- zero-change processes (stated as 1.0 so the UI can say "no change") ----
  { operation: "blend", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "mix", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "assemble", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "cool", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "refrigerate", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "freeze", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "refrigerate", qualifier: null, nutrient: "VITC", factor: 0.98, source: "usda-r6 (seed, unverified)" },
  { operation: "freeze", qualifier: null, nutrient: "VITC", factor: 0.95, source: "usda-r6 (seed, unverified)" },
  { operation: "marinate", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "grate", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "dice", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "slice", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
  { operation: "chop", qualifier: null, nutrient: "ENERC_KCAL", factor: 1, source: "method (seed)" },
];
