/**
 * Open Food Facts lookup. A barcode resolves to a product record, which we
 * convert into a CapturedFoodInput proposal. OFF data is never trusted as
 * truth: every value carries source = "openfoodfacts" and the label's basis.
 */

import type { CapturedFoodInput } from "@/lib/captured-food";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";

const OFF_NUTRIENT_MAP: Record<string, NutrientCode> = {
  "energy-kcal_100g": "ENERC_KCAL",
  "energy-kcal": "ENERC_KCAL",
  proteins_100g: "PROCNT",
  fat_100g: "FAT",
  carbohydrates_100g: "CHOCDF",
  fiber_100g: "FIBTG",
  sugars_100g: "SUGAR",
  sodium_100g: "NA",
  potassium_100g: "K",
  calcium_100g: "CA",
  iron_100g: "FE",
  zinc_100g: "ZN",
  magnesium_100g: "MG",
  "vitamin-a_100g": "VITA_RAE",
  "vitamin-c_100g": "VITC",
  "vitamin-d_100g": "VITD",
  "vitamin-b12_100g": "VITB12",
  "folate_100g": "FOL",
  "vitamin-b6_100g": "VITB6",
};

export interface OffProduct {
  code: string;
  name: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  nutrients: Partial<Record<NutrientCode, number>>;
  basis: "per_100g";
  /** Grams per serving from the label (`serving_quantity`), when declared. */
  servingSizeG?: number;
  /** The label's serving phrase ("1 cup", "30 g"), when declared. */
  servingLabel?: string;
}

export async function lookupBarcode(barcode: string): Promise<OffProduct | null> {
  const code = barcode.trim();
  if (!/^\d{8,14}$/.test(code)) return null;

  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "NutriPlan/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  if (data?.status !== 1 || !data?.product) return null;

  const product = data.product;
  const nutriments = product.nutriments ?? {};
  const nutrients: Partial<Record<NutrientCode, number>> = {};
  for (const [offKey, code2] of Object.entries(OFF_NUTRIENT_MAP)) {
    const value = nutriments[offKey];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      nutrients[code2] = value;
    }
  }

  // Sodium is stored as salt sometimes; convert if needed.
  if (nutrients.NA == null && typeof nutriments["salt_100g"] === "number") {
    nutrients.NA = (nutriments["salt_100g"] as number) * 400; // salt g -> sodium mg (approx)
  }

  // The declared serving: a gram size and/or the label's own phrase
  // ("1 cup"). Feeds the default-amount chain's "serving" tier.
  const servingSizeG =
    typeof product.serving_quantity === "number" &&
    Number.isFinite(product.serving_quantity) &&
    product.serving_quantity > 0
      ? product.serving_quantity
      : undefined;
  const servingLabel =
    typeof product.serving_size === "string" && product.serving_size.trim()
      ? product.serving_size.trim()
      : undefined;

  return {
    code,
    name: product.product_name || product.generic_name || `Product ${code}`,
    brand: product.brands,
    category: product.categories_tags?.[0]?.replace(/^en:/, "") || "Custom",
    imageUrl: product.image_url,
    nutrients,
    basis: "per_100g",
    servingSizeG,
    servingLabel,
  };
}

export function offToInput(product: OffProduct): CapturedFoodInput {
  return {
    name: product.brand ? `${product.name} (${product.brand})` : product.name,
    aliases: product.brand ? [product.brand] : [],
    category: "Custom",
    kind: "branded",
    state: "raw",
    basis: "per_100g",
    source: "openfoodfacts",
    sourceCode: product.code,
    imagePath: product.imageUrl,
    nutrients: product.nutrients,
    servingSizeG: product.servingSizeG,
    // A named serving ("1 cup", "2 biscuits") becomes a portion, so the
    // food can be logged in the phrase the label itself uses. A serving
    // that is just a weight ("30 g") is not a name — keep it as the
    // serving size only, which the chain's "serving" tier already reads.
    portions:
      product.servingSizeG != null && product.servingLabel
        ? (() => {
            const phrase = product.servingLabel!.trim();
            if (/^[\d.,\s]+(g|gr|gram|grams|ml|l|kg|oz)$/i.test(phrase)) return undefined;
            const label = /^1\s+/.test(phrase) ? phrase : `1 ${phrase}`;
            return [{ label, grams: product.servingSizeG!, source: "label serving" }];
          })()
        : undefined,
  };
}
