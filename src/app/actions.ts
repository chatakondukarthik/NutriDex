"use server";

import { revalidatePath } from "next/cache";
import { addEntry, removeEntry, today } from "@/lib/db/entries";
import { getFood } from "@/lib/data/foods";
import { toGrams, type Unit } from "@/lib/nutrition/units";

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
