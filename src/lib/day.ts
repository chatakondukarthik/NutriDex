import type { Entry } from "@/lib/db/entries";
import type { Food } from "@/lib/nutrition/types";
import { rollup, type Rollup } from "@/lib/nutrition/engine";

/**
 * Roll up every entry in a day into one nutrient result.
 *
 * The food resolver is injected so this module stays free of any database
 * import — it runs in the browser through the diary. Server callers pass
 * `requireFood` (or a map lookup); tests pass a seed map.
 */
export function dayRollup(
  entries: Entry[],
  resolveFood: (id: string) => Food = () => {
    throw new Error("dayRollup needs a food resolver in this context");
  },
): Rollup {
  return rollup(
    entries.map((entry) => {
      const food = resolveFood(entry.foodId);
      return { label: food.name, profile: food.nutrients, grams: entry.grams };
    }),
  );
}
