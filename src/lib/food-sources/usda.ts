/**
 * USDA FoodData Central search. Public domain data; a free API key raises
 * the rate limit. Falls back to DEMO_KEY.
 */

import type { CapturedFoodInput } from "@/lib/captured-food";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";

const USDA_NUTRIENT_MAP: Record<number, NutrientCode> = {
  1008: "ENERC_KCAL",
  1003: "PROCNT",
  1004: "FAT",
  1005: "CHOCDF",
  1079: "FIBTG",
  2000: "SUGAR",
  1093: "NA",
  1092: "K",
  1087: "CA",
  1089: "FE",
  1095: "ZN",
  1090: "MG",
  1106: "VITA_RAE",
  1162: "VITC",
  1114: "VITD",
  1178: "VITB12",
  1177: "FOL",
  1175: "VITB6",
};

export interface UsdaFood {
  fdcId: number;
  name: string;
  brand?: string;
  category?: string;
  nutrients: Partial<Record<NutrientCode, number>>;
  /** Household measures the USDA publishes for this food ("1 cup = 237 g"). */
  portions?: { label: string; grams: number; source: string }[];
}

/** Past this the body is not a food record — refuse before JSON.parse. */
const MAX_RESPONSE_CHARS = 5_000_000;

/**
 * Read and parse a response with a size cap. `res.json()` would buffer
 * whatever the endpoint sends first; reading the text lets us bound it
 * (security checklist: response size capped before parsing).
 */
async function readBoundedJson(res: Response): Promise<any> {
  const text = await res.text();
  // `.length` counts UTF-16 units rather than bytes — close enough to
  // bound the memory a hostile or broken endpoint can make us allocate.
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new Error("The USDA response was too large.");
  }
  return JSON.parse(text);
}

export async function searchUsda(query: string): Promise<UsdaFood[]> {
  const q = query.trim();
  if (!q) return [];
  const key = process.env.NUTRIPLAN_USDA_KEY ?? "DEMO_KEY";
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&pageSize=12&api_key=${encodeURIComponent(key)}`;
  // Bounded: this runs inside recipe saves and searches — a stalled
  // connection must fail fast, not hang the request indefinitely.
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = await readBoundedJson(res);
  const foods = (data?.foods ?? []) as any[];
  return foods.map((f) => {
    const nutrients: Partial<Record<NutrientCode, number>> = {};
    for (const n of f.foodNutrients ?? []) {
      const code = USDA_NUTRIENT_MAP[n.nutrientId];
      if (code && typeof n.value === "number" && Number.isFinite(n.value)) {
        nutrients[code] = n.value;
      }
    }
    return {
      fdcId: f.fdcId,
      name: f.description ?? f.lowercaseDescription ?? `Food ${f.fdcId}`,
      brand: f.brandName,
      category: f.foodCategory,
      nutrients,
    };
  });
}

/**
 * Household measures from a USDA food-detail response.
 *
 * `foodPortions` rows carry a measure ("1 cup", "1 tbsp") and a
 * `gramWeight`, which is exactly a `Portion`. Rows without a weight, or
 * with "none" measures, are skipped — an unusable portion would break
 * conversion rather than help it.
 */
function mapUsdaPortions(f: any): { label: string; grams: number; source: string }[] {
  const rows = f.foodPortions ?? f.portions ?? [];
  const out: { label: string; grams: number; source: string }[] = [];
  for (const row of rows) {
    const grams = Number(row.gramWeight ?? row.gram_weight);
    if (!Number.isFinite(grams) || grams <= 0) continue;
    const measure = row.measureUnit?.name ?? row.measure_unit?.name ?? "";
    const description = row.portionDescription ?? row.portion_description ?? "";
    const amount = Number(row.amount);
    const label =
      (description && !/^none/i.test(description) ? description : "") ||
      (measure && !/^none$/i.test(measure)
        ? `${Number.isFinite(amount) && amount > 0 ? amount : 1} ${measure}`
        : "");
    if (!label) continue;
    out.push({ label, grams, source: "USDA household measure" });
  }
  return out;
}

export async function getUsdaFood(fdcId: number): Promise<UsdaFood | null> {
  // The id is spliced into the URL path below. The action layer validates
  // it too, but a non-integer here would be a path-injection vector, so
  // reject it before the request exists.
  if (!Number.isInteger(fdcId) || fdcId <= 0) {
    throw new Error("Invalid USDA food id.");
  }
  const key = process.env.NUTRIPLAN_USDA_KEY ?? "DEMO_KEY";
  const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const f = await readBoundedJson(res);
  const nutrients: Partial<Record<NutrientCode, number>> = {};
  for (const n of f.foodNutrients ?? []) {
    const id = n.nutrient?.id ?? n.nutrientId;
    const code = USDA_NUTRIENT_MAP[id];
    if (code && typeof n.amount === "number" && Number.isFinite(n.amount)) {
      nutrients[code] = n.amount;
    }
  }
  const portions = mapUsdaPortions(f);
  return {
    fdcId: f.fdcId,
    name: f.description ?? `Food ${f.fdcId}`,
    brand: f.brandName,
    category: f.foodCategory?.description,
    nutrients,
    portions: portions.length > 0 ? portions : undefined,
  };
}

export function usdaToInput(food: UsdaFood): CapturedFoodInput {
  return {
    name: food.brand ? `${food.name} (${food.brand})` : food.name,
    aliases: food.brand ? [food.brand] : [],
    category: food.category || "Custom",
    kind: "branded",
    state: "raw",
    basis: "per_100g",
    source: "usda",
    sourceCode: String(food.fdcId),
    nutrients: food.nutrients,
    portions: food.portions,
  };
}
