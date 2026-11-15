/**
 * Reference retention factors for common cooking operations (R2).
 *
 * Keyed by (operation, nutrient). Factor 1.0 = unchanged. Values are
 * approximate and sourced from USDA yield/retention data where available;
 * the rest are seed estimates. Anything not listed defaults to 1.0 and is
 * disclosed as "no reference data — assumed unchanged".
 */

import type { ProcessOperation } from "./recipe-graph";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";

export type RetentionEntry = {
  operation: string;
  nutrient: NutrientCode;
  factor: number;
  source: string;
};

const SEED: RetentionEntry[] = [
  // Boiling (water-soluble vitamins leach)
  { operation: "boil", nutrient: "VITC", factor: 0.65, source: "usda-retention" },
  { operation: "boil", nutrient: "FOL", factor: 0.70, source: "usda-retention" },
  { operation: "boil", nutrient: "VITB6", factor: 0.75, source: "usda-retention" },
  { operation: "boil", nutrient: "VITB12", factor: 0.85, source: "usda-retention" },
  { operation: "boil", nutrient: "K", factor: 0.80, source: "usda-retention" },
  { operation: "boil", nutrient: "NA", factor: 0.90, source: "usda-retention" },
  { operation: "boil", nutrient: "MG", factor: 0.85, source: "usda-retention" },
  { operation: "boil", nutrient: "CA", factor: 0.95, source: "usda-retention" },
  { operation: "boil", nutrient: "FE", factor: 0.95, source: "usda-retention" },
  // Steaming (gentler)
  { operation: "steam", nutrient: "VITC", factor: 0.85, source: "usda-retention" },
  { operation: "steam", nutrient: "FOL", factor: 0.90, source: "usda-retention" },
  { operation: "steam", nutrient: "VITB6", factor: 0.90, source: "usda-retention" },
  // Frying (fat-soluble losses, fat absorption)
  { operation: "fry", nutrient: "VITC", factor: 0.70, source: "usda-retention" },
  { operation: "fry", nutrient: "FOL", factor: 0.75, source: "usda-retention" },
  { operation: "fry", nutrient: "VITB6", factor: 0.80, source: "usda-retention" },
  { operation: "fry", nutrient: "VITA_RAE", factor: 0.85, source: "usda-retention" },
  { operation: "fry", nutrient: "VITD", factor: 0.90, source: "usda-retention" },
  { operation: "fry", nutrient: "FAT", factor: 1.15, source: "seed" }, // oil absorption
  // Baking/roasting
  { operation: "bake", nutrient: "VITC", factor: 0.75, source: "usda-retention" },
  { operation: "bake", nutrient: "FOL", factor: 0.80, source: "usda-retention" },
  { operation: "bake", nutrient: "VITB6", factor: 0.85, source: "usda-retention" },
  { operation: "roast", nutrient: "VITC", factor: 0.70, source: "usda-retention" },
  { operation: "roast", nutrient: "FOL", factor: 0.75, source: "usda-retention" },
  // Cooling (resistant starch not tracked; minor vitamin loss)
  { operation: "cool", nutrient: "VITC", factor: 0.98, source: "seed" },
  // Freezing
  { operation: "freeze", nutrient: "VITC", factor: 0.90, source: "usda-retention" },
  { operation: "freeze", nutrient: "FOL", factor: 0.90, source: "usda-retention" },
  // Drying/dehydration
  { operation: "dry", nutrient: "VITC", factor: 0.50, source: "usda-retention" },
  { operation: "dry", nutrient: "VITB6", factor: 0.70, source: "usda-retention" },
  { operation: "dry", nutrient: "FOL", factor: 0.60, source: "usda-retention" },
];

const LOOKUP = new Map<string, RetentionEntry>();
for (const e of SEED) LOOKUP.set(`${e.operation}|${e.nutrient}`, e);

export function getRetention(operation: string, nutrient: NutrientCode): RetentionEntry | null {
  return LOOKUP.get(`${operation}|${nutrient}`) ?? null;
}

export function retentionFor(operation: string): Partial<Record<NutrientCode, number>> {
  const out: Partial<Record<NutrientCode, number>> = {};
  for (const code of NUTRIENT_CODES) {
    const e = getRetention(operation, code);
    if (e) out[code] = e.factor;
  }
  return out;
}

export function effectFromRetention(operation: ProcessOperation): import("./recipe-graph").ProcessEffect {
  const retention = retentionFor(operation);
  // fill missing with 1.0
  const full: Partial<Record<NutrientCode, number>> = {};
  for (const code of NUTRIENT_CODES) full[code] = retention[code] ?? 1;
  return {
    operation,
    retention: full,
    added: {},
    removed: {},
    source: Object.keys(retention).length > 0 ? "reference" : "none",
    rationale:
      Object.keys(retention).length > 0
        ? `Reference retention factors applied for ${operation}.`
        : `No reference retention data for ${operation}; assumed unchanged.`,
    confidence: Object.keys(retention).length > 0 ? 0.7 : 0.3,
  };
}
