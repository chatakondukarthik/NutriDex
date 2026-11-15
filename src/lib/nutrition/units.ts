import type { Food, Portion } from "./types";

export type Unit = "g" | "kg" | "ml" | "l" | "portion";

export interface Quantity {
  amount: number;
  unit: Unit;
  /** When unit is "portion", which of the food's portions. */
  portionLabel?: string;
}

export type GramResult =
  | {
      ok: true;
      grams: number;
      basis: "mass" | "volume" | "portion";
      /** Set when an assumption was made (e.g. density defaulted to 1). */
      note?: string;
    }
  | { ok: false; reason: string };

export const UNITS: { value: Unit; label: string }[] = [
  { value: "g", label: "grams" },
  { value: "kg", label: "kilograms" },
  { value: "ml", label: "millilitres" },
  { value: "l", label: "litres" },
  { value: "portion", label: "portion" },
];

/**
 * One tonne. Well beyond any plausible single ingredient, recipe batch or
 * diary entry, but small enough to catch a typo or an overflow before it
 * becomes an infinite nutrient total.
 */
export const MAX_GRAMS = 1_000_000;

function gramResult(grams: number, basis: "mass" | "volume" | "portion", note?: string): GramResult {
  // Check the *result*, not just the input: `1e308 kg` is a finite number
  // that overflows to Infinity grams, and Infinity in a total is invisible.
  if (!Number.isFinite(grams) || grams <= 0) {
    return { ok: false, reason: "Quantity must be a positive number." };
  }
  if (grams > MAX_GRAMS) {
    return { ok: false, reason: "That quantity is too large — check the amount." };
  }
  return note ? { ok: true, grams, basis, note } : { ok: true, grams, basis };
}

/**
 * Convert a user quantity to grams.
 *
 * This is the highest-risk function in the product: a wrong conversion
 * makes every downstream number wrong while still looking plausible. It
 * therefore never guesses silently — anything assumed is returned as a
 * note, and anything unknown is a hard failure.
 */
export function toGrams(food: Food, quantity: Quantity): GramResult {
  if (!Number.isFinite(quantity.amount) || quantity.amount <= 0) {
    return { ok: false, reason: "Quantity must be a positive number." };
  }

  switch (quantity.unit) {
    case "g":
      return gramResult(quantity.amount, "mass");

    case "kg":
      return gramResult(quantity.amount * 1000, "mass");

    case "ml": {
      const density = food.densityGPerMl;
      if (density == null) {
        return gramResult(
          quantity.amount,
          "volume",
          "Assumed 1 g/ml; this food has no density on record.",
        );
      }
      return gramResult(quantity.amount * density, "volume");
    }

    case "l": {
      const density = food.densityGPerMl;
      if (density == null) {
        return gramResult(
          quantity.amount * 1000,
          "volume",
          "Assumed 1 g/ml; this food has no density on record.",
        );
      }
      return gramResult(quantity.amount * 1000 * density, "volume");
    }

    case "portion": {
      const portion = findPortion(food, quantity.portionLabel);
      if (!portion) {
        return {
          ok: false,
          reason: `No portion "${quantity.portionLabel ?? "?"}" is defined for ${food.name}.`,
        };
      }
      return gramResult(quantity.amount * portion.grams, "portion");
    }

    default:
      return { ok: false, reason: `Unsupported unit.` };
  }
}

export function findPortion(food: Food, label?: string): Portion | undefined {
  if (!label) return undefined;
  return food.portions.find((p) => p.label === label);
}

/** All selectable units for a food, including its named portions. */
export function unitsFor(food: Food): { value: string; label: string }[] {
  return [
    { value: "g", label: "g" },
    { value: "ml", label: "ml" },
    ...food.portions.map((p) => ({ value: `portion:${p.label}`, label: p.label })),
  ];
}
