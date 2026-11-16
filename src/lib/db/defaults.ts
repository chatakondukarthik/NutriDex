/**
 * The stored half of the default-amount chain: the user's pin and the
 * amount they last used for a food. See `@/lib/nutrition/defaults` for
 * the pure resolver these feed.
 *
 * Pins live in their own table keyed by food id rather than on
 * `captured_foods`, because seed foods exist only in code — a pin must
 * work for both without the merge layer knowing about it.
 */

import { db } from "./client";
import { getFood } from "./foods";
import { defaultAmountFor, type DefaultAmount } from "@/lib/nutrition/defaults";

export interface AmountUnit {
  amount: number;
  unit: string;
}

export function getFoodDefaultPin(foodId: string): AmountUnit | null {
  const row = db
    .prepare("SELECT amount, unit FROM food_default_amounts WHERE food_id = ?")
    .get(foodId) as unknown as { amount: number; unit: string } | undefined;
  if (!row) return null;
  return { amount: row.amount, unit: row.unit };
}

/** `null` clears the pin; the caller passes undefined to leave it alone. */
export function setFoodDefaultPin(
  foodId: string,
  pin: AmountUnit | null,
): void {
  if (pin === null) {
    db.prepare("DELETE FROM food_default_amounts WHERE food_id = ?").run(foodId);
    return;
  }
  db.prepare(
    `INSERT INTO food_default_amounts (food_id, amount, unit, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(food_id) DO UPDATE SET
       amount = excluded.amount,
       unit = excluded.unit,
       updated_at = excluded.updated_at`,
  ).run(foodId, pin.amount, pin.unit, new Date().toISOString());
}

/**
 * The most recent amount+unit used for this food anywhere: plan, diary
 * or a recipe ingredient. All three store the same unit-key convention
 * (`g`, `tbsp`, `portion:label`), so one union answers all of them.
 *
 * `created_at` is ISO-8601 in every table, so string order is time
 * order across the union.
 */
export function lastUsedAmountFor(foodId: string): AmountUnit | null {
  const row = db
    .prepare(
      `SELECT amount, unit FROM (
         SELECT amount, unit, created_at
           FROM plan_entries
          WHERE food_id = ? AND amount IS NOT NULL AND unit IS NOT NULL
         UNION ALL
         SELECT amount, unit, created_at
           FROM entries
          WHERE food_id = ? AND amount IS NOT NULL
         UNION ALL
         SELECT ci.amount, ci.unit, rv.created_at
           FROM component_inputs ci
           JOIN components c ON c.id = ci.component_id
           JOIN recipe_versions rv ON rv.id = c.recipe_version_id
          WHERE ci.food_id = ?
       )
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(foodId, foodId, foodId) as unknown as AmountUnit | undefined;
  if (!row) return null;
  return { amount: row.amount, unit: row.unit };
}

/** Full chain for one food, or null when the food does not exist. */
export function resolveDefaultAmount(foodId: string): DefaultAmount | null {
  const food = getFood(foodId);
  if (!food) return null;
  return defaultAmountFor(food, {
    pin: getFoodDefaultPin(foodId),
    lastUsed: lastUsedAmountFor(foodId),
  });
}
