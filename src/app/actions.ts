"use server";

import { revalidatePath } from "next/cache";
import { addEntry, removeEntry, today } from "@/lib/db/entries";
import { getFood } from "@/lib/data/foods";
import { toGrams, type Unit } from "@/lib/nutrition/units";
import { saveRecipeDraft, type RecipeDraft } from "@/lib/recipes";

export interface AddResult {
  ok: boolean;
  message?: string;
}

const VALID_UNITS: Unit[] = ["g", "kg", "ml", "l", "portion"];

/**
 * Add a food to today's list.
 *
 * Treat every server action as an untrusted entry point: validate the
 * unit, the amount and the food id here, and never trust the client to
 * have done it. The gram conversion lives on the server for the same
 * reason — there is exactly one place a weight can be produced.
 */
export async function addFoodAction(input: {
  foodId: string;
  amount: number;
  unit: string;
  portionLabel?: string;
}): Promise<AddResult> {
  const food = getFood(input.foodId);
  if (!food) {
    return { ok: false, message: "That food does not exist." };
  }

  if (!VALID_UNITS.includes(input.unit as Unit)) {
    return { ok: false, message: "Unsupported unit." };
  }

  const unit = input.unit as Unit;
  const converted = toGrams(food, {
    amount: input.amount,
    unit,
    portionLabel: input.portionLabel,
  });

  if (!converted.ok) {
    return { ok: false, message: converted.reason };
  }

  addEntry({
    foodId: food.id,
    grams: converted.grams,
    amount: input.amount,
    unit: input.unit,
    day: today(),
  });

  revalidatePath("/");
  return { ok: true };
}

export async function removeEntryAction(id: string): Promise<void> {
  removeEntry(id);
  revalidatePath("/");
}

export interface SaveRecipeResult {
  ok: boolean;
  message?: string;
  recipeId?: string;
  versionId?: string;
  versionNo?: number;
}

/**
 * Save a recipe draft.
 *
 * Every save produces a new immutable version (D-018, D-024). The
 * nutrition snapshot is computed here, on the server, from the stored
 * gram weights — never trusted from the client.
 */
export async function saveRecipeAction(draft: RecipeDraft): Promise<SaveRecipeResult> {
  try {
    const result = saveRecipeDraft(draft);
    if (!result.ok) return result;

    revalidatePath("/recipes");
    revalidatePath(`/recipes/${result.recipeId}`);

    return {
      ok: true,
      recipeId: result.recipeId,
      versionId: result.versionId,
      versionNo: result.versionNo,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not save the recipe.",
    };
  }
}
