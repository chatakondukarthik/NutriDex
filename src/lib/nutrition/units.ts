import type { Food, Portion } from "./types";

export type Unit = "g" | "kg" | "oz" | "lb" | "ml" | "l" | "tsp" | "tbsp" | "fl_oz" | "cup" | "portion";

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
  { value: "oz", label: "ounces" },
  { value: "lb", label: "pounds" },
  { value: "ml", label: "millilitres" },
  { value: "l", label: "litres" },
  { value: "tsp", label: "tsp" },
  { value: "tbsp", label: "tbsp" },
  { value: "fl_oz", label: "fl oz" },
  { value: "cup", label: "cup" },
  { value: "portion", label: "portion" },
];

/** Exact factor: how many tentatively-named units equal a gram (mass) or ml (volume). */
const MASS_FACTORS: Partial<Record<Unit, number>> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

const VOLUME_FACTORS: Partial<Record<Unit, number>> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  fl_oz: 29.5735295625,
  cup: 236.5882365,
};

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
    case "kg":
    case "oz":
    case "lb":
      return gramResult(quantity.amount * (MASS_FACTORS[quantity.unit] ?? 1), "mass");

    case "ml":
    case "l":
    case "tsp":
    case "tbsp":
    case "fl_oz":
    case "cup": {
      const density = food.densityGPerMl;
      const volumeMl = quantity.amount * (VOLUME_FACTORS[quantity.unit] ?? 1);
      if (density == null) {
        return gramResult(
          volumeMl,
          "volume",
          "Assumed 1 g/ml; this food has no density on record.",
        );
      }
      return gramResult(volumeMl * density, "volume");
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

/** Parse a select-value like "portion:egg" or a plain unit like "g". */
export function parseUnitKey(key: string): { unit: Unit; portionLabel?: string } {
  if (key.startsWith("portion:")) {
    return { unit: "portion", portionLabel: key.slice("portion:".length) };
  }
  return { unit: key as Unit };
}

/** All selectable units for a food: universal mass/volume, then its named portions. */
export function unitsFor(food: Food): { value: string; label: string }[] {
  return [
    { value: "g", label: "g" },
    { value: "kg", label: "kg" },
    { value: "oz", label: "oz" },
    { value: "lb", label: "lb" },
    { value: "ml", label: "ml" },
    { value: "l", label: "l" },
    { value: "tsp", label: "tsp" },
    { value: "tbsp", label: "tbsp" },
    { value: "fl_oz", label: "fl oz" },
    { value: "cup", label: "cup" },
    ...food.portions.map((p) => ({ value: `portion:${p.label}`, label: p.label })),
  ];
}
