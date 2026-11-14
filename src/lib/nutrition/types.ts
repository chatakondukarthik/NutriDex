/**
 * The canonical nutrient vocabulary (D-025).
 *
 * Every source is mapped into these codes. Adding a nutrient later is a
 * data change, not a schema migration — the profile is a record keyed by
 * code, so an unknown code is simply absent, never a broken column.
 */

export const NUTRIENT_CODES = [
  // energy + macros
  "ENERC_KCAL",
  "PROCNT",
  "FAT",
  "CHOCDF",
  "FIBTG",
  "SUGAR",
  // minerals
  "NA",
  "K",
  "CA",
  "FE",
  "ZN",
  "MG",
  // vitamins
  "VITA_RAE",
  "VITC",
  "VITD",
  "VITB12",
  "FOL",
  "VITB6",
] as const;

export type NutrientCode = (typeof NUTRIENT_CODES)[number];

export type NutrientUnit = "kcal" | "g" | "mg" | "µg";

export type NutrientGroup = "energy" | "macro" | "mineral" | "vitamin";

export interface NutrientMeta {
  code: NutrientCode;
  label: string;
  short: string;
  unit: NutrientUnit;
  group: NutrientGroup;
  /** "max" nutrients are limits: going over is the bad direction. */
  direction: "min" | "max";
  /** Decimal places to show in the UI. */
  precision: number;
}

export const NUTRIENTS: Record<NutrientCode, NutrientMeta> = {
  ENERC_KCAL: { code: "ENERC_KCAL", label: "Energy", short: "kcal", unit: "kcal", group: "energy", direction: "min", precision: 0 },
  PROCNT: { code: "PROCNT", label: "Protein", short: "Protein", unit: "g", group: "macro", direction: "min", precision: 1 },
  FAT: { code: "FAT", label: "Fat", short: "Fat", unit: "g", group: "macro", direction: "max", precision: 1 },
  CHOCDF: { code: "CHOCDF", label: "Carbohydrate", short: "Carbs", unit: "g", group: "macro", direction: "min", precision: 1 },
  FIBTG: { code: "FIBTG", label: "Fibre", short: "Fibre", unit: "g", group: "macro", direction: "min", precision: 1 },
  SUGAR: { code: "SUGAR", label: "Total sugars", short: "Sugar", unit: "g", group: "macro", direction: "max", precision: 1 },
  NA: { code: "NA", label: "Sodium", short: "Sodium", unit: "mg", group: "mineral", direction: "max", precision: 0 },
  K: { code: "K", label: "Potassium", short: "Potassium", unit: "mg", group: "mineral", direction: "min", precision: 0 },
  CA: { code: "CA", label: "Calcium", short: "Calcium", unit: "mg", group: "mineral", direction: "min", precision: 0 },
  FE: { code: "FE", label: "Iron", short: "Iron", unit: "mg", group: "mineral", direction: "min", precision: 1 },
  ZN: { code: "ZN", label: "Zinc", short: "Zinc", unit: "mg", group: "mineral", direction: "min", precision: 1 },
  MG: { code: "MG", label: "Magnesium", short: "Magnesium", unit: "mg", group: "mineral", direction: "min", precision: 0 },
  VITA_RAE: { code: "VITA_RAE", label: "Vitamin A", short: "Vit A", unit: "µg", group: "vitamin", direction: "min", precision: 0 },
  VITC: { code: "VITC", label: "Vitamin C", short: "Vit C", unit: "mg", group: "vitamin", direction: "min", precision: 1 },
  VITD: { code: "VITD", label: "Vitamin D", short: "Vit D", unit: "µg", group: "vitamin", direction: "min", precision: 1 },
  VITB12: { code: "VITB12", label: "Vitamin B12", short: "Vit B12", unit: "µg", group: "vitamin", direction: "min", precision: 1 },
  FOL: { code: "FOL", label: "Folate", short: "Folate", unit: "µg", group: "vitamin", direction: "min", precision: 0 },
  VITB6: { code: "VITB6", label: "Vitamin B6", short: "Vit B6", unit: "mg", group: "vitamin", direction: "min", precision: 1 },
};

/**
 * A nutrient value is never a bare number.
 *
 * `null` means "we do not know", which is different from zero. Every
 * value carries where it came from, so the UI can answer "how was this
 * calculated?" (D-008, D-010).
 */
export interface NutrientValue {
  /** Amount per 100 g edible portion. null = unknown, never zero. */
  amount: number | null;
  status: NutrientStatus;
  source: string;
  sourceFoodCode?: string;
}

export type NutrientStatus = "known" | "estimated" | "unknown";

export type NutrientProfile = Record<NutrientCode, NutrientValue>;

export interface Portion {
  /** How the user names it: "1 katori", "1 medium", "1 tbsp". */
  label: string;
  grams: number;
  source: string;
}

export interface Food {
  id: string;
  name: string;
  /** Hindi / regional / common alternate names, for search. */
  aliases: string[];
  category: string;
  kind: "raw" | "branded" | "composite";
  /** Whether the per-100 g values describe the raw or cooked item. */
  state: "raw" | "cooked";
  /** g per ml. Only needed for volume units. */
  densityGPerMl?: number;
  portions: Portion[];
  nutrients: NutrientProfile;
}
