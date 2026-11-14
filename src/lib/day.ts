import { requireFood } from "@/lib/data/foods";
import type { Entry } from "@/lib/db/entries";
import { rollup, type Rollup } from "@/lib/nutrition/engine";

/** Roll up every entry in a day into one nutrient result. */
export function dayRollup(entries: Entry[]): Rollup {
  return rollup(
    entries.map((entry) => {
      const food = requireFood(entry.foodId);
      return { label: food.name, profile: food.nutrients, grams: entry.grams };
    }),
  );
}
