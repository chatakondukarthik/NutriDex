import type { NutrientCode } from "@/lib/nutrition/types";

/**
 * Daily targets.
 *
 * SEED VALUES for an adult, moderate activity. The real target engine
 * (age, sex, activity, goal) is deliberately deferred — but the shape
 * here is the contract it will implement:
 *
 *   { nutrient, direction, value, period }
 *
 * Nothing in the UI hardcodes a number; it reads from this object, so
 * swapping in a computed target later is a data change.
 */
export interface Target {
  code: NutrientCode;
  value: number;
  direction: "min" | "max";
  period: "day";
}

export const DEFAULT_TARGETS: Target[] = [
  { code: "ENERC_KCAL", value: 2000, direction: "min", period: "day" },
  { code: "PROCNT", value: 60, direction: "min", period: "day" },
  { code: "FAT", value: 55, direction: "max", period: "day" },
  { code: "CHOCDF", value: 275, direction: "min", period: "day" },
  { code: "FIBTG", value: 30, direction: "min", period: "day" },
  { code: "SUGAR", value: 50, direction: "max", period: "day" },
  { code: "NA", value: 2000, direction: "max", period: "day" },
  { code: "K", value: 3500, direction: "min", period: "day" },
  { code: "CA", value: 1000, direction: "min", period: "day" },
  { code: "FE", value: 17, direction: "min", period: "day" },
  { code: "ZN", value: 12, direction: "min", period: "day" },
  { code: "MG", value: 340, direction: "min", period: "day" },
  { code: "VITA_RAE", value: 600, direction: "min", period: "day" },
  { code: "VITC", value: 80, direction: "min", period: "day" },
  { code: "VITD", value: 15, direction: "min", period: "day" },
  { code: "VITB12", value: 2.2, direction: "min", period: "day" },
  { code: "FOL", value: 300, direction: "min", period: "day" },
  { code: "VITB6", value: 1.3, direction: "min", period: "day" },
];

export const TARGET_BY_CODE = new Map(DEFAULT_TARGETS.map((t) => [t.code, t]));
