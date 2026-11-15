import { randomUUID } from "node:crypto";
import { db, transaction } from "./client";

export interface Entry {
  id: string;
  foodId: string | null;
  recipeVersionId: string | null;
  /** Resolved gram weight. Foods: grams of food; recipes: input grams × servings. */
  grams: number;
  /** What the user actually typed, kept for display and audit. */
  amount: number;
  unit: string;
  day: string;
  createdAt: string;
}

interface Row {
  id: string;
  food_id: string | null;
  recipe_version_id: string | null;
  grams: number;
  amount: number;
  unit: string;
  day: string;
  created_at: string;
}

function toEntry(row: Row): Entry {
  return {
    id: row.id,
    foodId: row.food_id,
    recipeVersionId: row.recipe_version_id,
    grams: row.grams,
    amount: row.amount,
    unit: row.unit,
    day: row.day,
    createdAt: row.created_at,
  };
}

export function listEntries(day: string): Entry[] {
  const rows = db
    .prepare("SELECT * FROM entries WHERE day = ? ORDER BY created_at ASC")
    .all(day) as unknown as Row[];
  return rows.map(toEntry);
}

export function addEntry(input: {
  foodId: string;
  grams: number;
  amount: number;
  unit: string;
  day: string;
}): Entry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  transaction(() => {
    db.prepare(
      `INSERT INTO entries (id, food_id, recipe_version_id, grams, amount, unit, day, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(id, input.foodId, input.grams, input.amount, input.unit, input.day, createdAt);
  });

  return {
    id,
    ...input,
    recipeVersionId: null,
    createdAt,
  };
}

export function addRecipeEntry(input: {
  recipeVersionId: string;
  servings: number;
  grams: number;
  amount: number;
  unit: string;
  day: string;
}): Entry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  transaction(() => {
    db.prepare(
      `INSERT INTO entries (id, food_id, recipe_version_id, grams, amount, unit, day, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.recipeVersionId,
      input.grams,
      input.amount,
      input.unit,
      input.day,
      createdAt,
    );
  });

  return {
    id,
    foodId: null,
    recipeVersionId: input.recipeVersionId,
    grams: input.grams,
    amount: input.amount,
    unit: input.unit,
    day: input.day,
    createdAt,
  };
}

export function removeEntry(id: string): void {
  db.prepare("DELETE FROM entries WHERE id = ?").run(id);
}

export function countEntriesForRecipe(recipeVersionIds: string[]): number {
  if (recipeVersionIds.length === 0) return 0;
  const placeholders = recipeVersionIds.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM entries WHERE recipe_version_id IN (${placeholders})`,
    )
    .get(...recipeVersionIds) as unknown as { n: number };
  return row.n;
}

export function today(): string {
  // Local calendar day. Timezone handling is deliberately naive in S1.
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
