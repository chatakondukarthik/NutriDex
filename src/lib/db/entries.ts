import { randomUUID } from "node:crypto";
import { db, transaction } from "./client";

export interface Entry {
  id: string;
  personId: string;
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
  person_id: string;
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
    personId: row.person_id,
    foodId: row.food_id,
    recipeVersionId: row.recipe_version_id,
    grams: row.grams,
    amount: row.amount,
    unit: row.unit,
    day: row.day,
    createdAt: row.created_at,
  };
}

export function listEntries(personId: string, day: string): Entry[] {
  const rows = db
    .prepare(
      "SELECT * FROM entries WHERE person_id = ? AND day = ? ORDER BY created_at ASC",
    )
    .all(personId, day) as unknown as Row[];
  return rows.map(toEntry);
}

export function addEntry(
  personId: string,
  input: {
    foodId: string;
    grams: number;
    amount: number;
    unit: string;
    day: string;
  },
): Entry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  transaction(() => {
    db.prepare(
      `INSERT INTO entries (id, person_id, food_id, recipe_version_id, grams, amount, unit, day, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      personId,
      input.foodId,
      input.grams,
      input.amount,
      input.unit,
      input.day,
      createdAt,
    );
  });

  return {
    id,
    personId,
    ...input,
    recipeVersionId: null,
    createdAt,
  };
}

export function addRecipeEntry(
  personId: string,
  input: {
    recipeVersionId: string;
    servings: number;
    grams: number;
    amount: number;
    unit: string;
    day: string;
  },
): Entry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  transaction(() => {
    db.prepare(
      `INSERT INTO entries (id, person_id, food_id, recipe_version_id, grams, amount, unit, day, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      personId,
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
    personId,
    foodId: null,
    recipeVersionId: input.recipeVersionId,
    grams: input.grams,
    amount: input.amount,
    unit: input.unit,
    day: input.day,
    createdAt,
  };
}

/**
 * Remove one of this person's diary entries.
 *
 * The person id is a filter, not an authorization check (the household is
 * trusted), but a stale id from another diary is still refused rather than
 * silently deleting a row the caller did not render.
 */
export function removeEntry(personId: string, id: string): void {
  const result = db
    .prepare("DELETE FROM entries WHERE id = ? AND person_id = ?")
    .run(id, personId);
  if (result.changes === 0) throw new Error("That diary entry no longer exists.");
}

export function countEntriesForPerson(personId: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(personId) as unknown as {
      n: number;
    }
  ).n;
}

/** Household-wide: deleting a recipe must see every person's diary. */
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
