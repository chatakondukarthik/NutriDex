import type { Entry } from "@/lib/db/entries";
import type { Food } from "@/lib/nutrition/types";
import type { Rollup } from "@/lib/nutrition/engine";
import type { PlanRecipeOption } from "@/lib/plan";
import { combine, rollup, scaleRollup } from "@/lib/nutrition/engine";

/**
 * Roll up every entry in a day into one nutrient result.
 *
 * Diary entries can reference either a food (grams scaled) or a pinned
 * recipe version (servings scaled). The food resolver is injected so this
 * module stays free of any database import — it runs in the browser.
 * `recipes` is optional; when absent, recipe entries are ignored.
 */
export function dayRollup(
  entries: Entry[],
  resolveFood: (id: string) => Food = () => {
    throw new Error("dayRollup needs a food resolver in this context");
  },
  recipeByVersion?: Map<string, PlanRecipeOption>,
): Rollup {
  const foodContributions: Array<{
    label: string;
    profile: Food["nutrients"];
    grams: number;
  }> = [];
  const recipeResults: Rollup[] = [];

  for (const entry of entries) {
    if (entry.foodId) {
      const food = resolveFood(entry.foodId);
      foodContributions.push({
        label: food.name,
        profile: food.nutrients,
        grams: entry.grams,
      });
      continue;
    }

    const recipe = recipeByVersion?.get(entry.recipeVersionId ?? "");
    if (recipe) {
      recipeResults.push(scaleRollup(recipe.perServing, entry.amount));
    }
  }

  if (foodContributions.length > 0) {
    const foodRoll = rollup(foodContributions);
    if (recipeResults.length === 0) return foodRoll;
    return combine([foodRoll, ...recipeResults]);
  }

  if (recipeResults.length === 0) {
    // empty day
    return rollup([]);
  }

  return combine(recipeResults);
}
