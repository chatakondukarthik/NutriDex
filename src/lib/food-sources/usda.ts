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
}

export async function searchUsda(query: string): Promise<UsdaFood[]> {
  const q = query.trim();
  if (!q) return [];
  const key = process.env.NUTRIPLAN_USDA_KEY ?? "DEMO_KEY";
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&pageSize=12&api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as any;
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

export async function getUsdaFood(fdcId: number): Promise<UsdaFood | null> {
  const key = process.env.NUTRIPLAN_USDA_KEY ?? "DEMO_KEY";
  const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const f = (await res.json()) as any;
  const nutrients: Partial<Record<NutrientCode, number>> = {};
  for (const n of f.foodNutrients ?? []) {
    const id = n.nutrient?.id ?? n.nutrientId;
    const code = USDA_NUTRIENT_MAP[id];
    if (code && typeof n.amount === "number" && Number.isFinite(n.amount)) {
      nutrients[code] = n.amount;
    }
  }
  return {
    fdcId: f.fdcId,
    name: f.description ?? `Food ${f.fdcId}`,
    brand: f.brandName,
    category: f.foodCategory?.description,
    nutrients,
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
  };
}
