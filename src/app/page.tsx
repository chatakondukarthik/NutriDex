import { Diary } from "@/components/diary";
import { listFoods } from "@/lib/db/foods";
import { listEntries, today } from "@/lib/db/entries";
import { getProfile } from "@/lib/db/profile";
import { targetsFor } from "@/lib/targets";
import { getPlan, listPlanEntries } from "@/lib/db/plan";
import { listRecipeOptions } from "@/lib/db/recipes";
import { weekStart, SLOTS, SLOT_LABELS, entryRollup, entriesForDay, versionName } from "@/lib/plan";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day: requested } = await searchParams;
  const day = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today();
  const entries = listEntries(day);
  const targets = targetsFor(getProfile());
  const foods = listFoods();

  // Planned for this day, so the Diary reflects the plan live.
  const plan = getPlan(weekStart(day));
  const allRecipes = listRecipeOptions();
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const recipeByVersion = new Map(listRecipeOptions().map((o) => [o.versionId, o]));
  const plannedRaw = plan ? entriesForDay(listPlanEntries(plan.id), day) : [];
  const planned = plannedRaw.map((entry) => {
    const kcal = entryRollup(entry, foodById, recipeByVersion)?.totals.ENERC_KCAL ?? null;
    let name = "Unknown";
    if (entry.foodId) name = foodById.get(entry.foodId)?.name ?? entry.foodId;
    else if (entry.recipeVersionId) {
      const recipe = recipeByVersion.get(entry.recipeVersionId);
      name = recipe ? versionName(recipe) : entry.recipeVersionId;
    }
    const slot = SLOTS.find((s) => s === entry.slot);
    return {
      id: entry.id,
      slot: slot ? SLOT_LABELS[slot] : entry.slot,
      name,
      qty: entry.foodId
        ? `${Math.round(entry.grams ?? 0)} g`
        : `${entry.servings} serving${entry.servings === 1 ? "" : "s"}`,
      kcal,
    };
  });
  const plannedKcal = planned.reduce((sum, item) => sum + (item.kcal ?? 0), 0);

  return <Diary foods={foods} recipes={allRecipes} entries={entries} targets={targets} day={day} planned={planned} plannedKcal={plannedKcal} />;
}
