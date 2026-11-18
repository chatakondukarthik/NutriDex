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

export function getFoodDefaultPin(personId: string, foodId: string): AmountUnit | null {
  const row = db
    .prepare("SELECT amount, unit FROM food_default_amounts WHERE person_id = ? AND food_id = ?")
    .get(personId, foodId) as unknown as { amount: number; unit: string } | undefined;
  if (!row) return null;
  return { amount: row.amount, unit: row.unit };
}

/** `null` clears the pin; the caller passes undefined to leave it alone. */
export function setFoodDefaultPin(
  personId: string,
  foodId: string,
  pin: AmountUnit | null,
): void {
  if (pin === null) {
    db.prepare("DELETE FROM food_default_amounts WHERE person_id = ? AND food_id = ?").run(
      personId,
      foodId,
    );
    return;
  }
  db.prepare(
    `INSERT INTO food_default_amounts (person_id, food_id, amount, unit, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(person_id, food_id) DO UPDATE SET
       amount = excluded.amount,
       unit = excluded.unit,
       updated_at = excluded.updated_at`,
  ).run(personId, foodId, pin.amount, pin.unit, new Date().toISOString());
}

/**
 * The most recent amount+unit this person used for a food in their own
 * diary or plan.
 *
 * Recipe ingredient lines are deliberately excluded: they are shared library
 * content, and letting one person's recipe edit change another person's
 * default amount would make a personal preference leak across the household.
 *
 * `created_at` is ISO-8601 in every table, so string order is time order
 * across the union.
 */
export function lastUsedAmountFor(personId: string, foodId: string): AmountUnit | null {
  const row = db
    .prepare(
      `SELECT amount, unit FROM (
         SELECT pe.amount AS amount, pe.unit AS unit, pe.created_at AS created_at
           FROM plan_entries pe
           JOIN plans p ON p.id = pe.plan_id
          WHERE p.person_id = ? AND pe.food_id = ?
            AND pe.amount IS NOT NULL AND pe.unit IS NOT NULL
         UNION ALL
         SELECT amount, unit, created_at
           FROM entries
          WHERE person_id = ? AND food_id = ? AND amount IS NOT NULL
       )
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(personId, foodId, personId, foodId) as unknown as AmountUnit | undefined;
  if (!row) return null;
  return { amount: row.amount, unit: row.unit };
}

/** Full chain for one food, or null when the food does not exist. */
export function resolveDefaultAmount(
  personId: string,
  foodId: string,
): DefaultAmount | null {
  const food = getFood(foodId);
  if (!food) return null;
  return defaultAmountFor(food, {
    pin: getFoodDefaultPin(personId, foodId),
    lastUsed: lastUsedAmountFor(personId, foodId),
  });
}

export function countDefaultPinsForPerson(personId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM food_default_amounts WHERE person_id = ?")
      .get(personId) as unknown as { n: number }
  ).n;
}
