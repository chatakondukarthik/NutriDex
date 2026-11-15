import { randomUUID } from "node:crypto";
import { db } from "./client";
import type { PlanEntry, Slot } from "@/lib/plan";

/**
 * Plan persistence.
 *
 * A plan is a week. Entries reference either a food or a **pinned recipe
 * version**, so correcting a recipe or a food record never rewrites a
 * week that was already planned (D-024, definition of done #4).
 *
 * There is one implicit local plan per week until accounts exist.
 */

export interface Plan {
  id: string;
  startsOn: string;
}

interface EntryRow {
  id: string;
  plan_id: string;
  day: string;
  slot: string;
  position: number;
  food_id: string | null;
  recipe_version_id: string | null;
  grams: number | null;
  amount: number | null;
  unit: string | null;
  servings: number | null;
}

function toEntry(row: EntryRow): PlanEntry {
  return {
    id: row.id,
    planId: row.plan_id,
    day: row.day,
    slot: row.slot as Slot,
    position: row.position,
    foodId: row.food_id,
    recipeVersionId: row.recipe_version_id,
    grams: row.grams,
    amount: row.amount,
    unit: row.unit,
    servings: row.servings,
  };
}

/** The week's plan if it exists, without creating one. */
export function getPlan(startsOn: string): Plan | null {
  const row = db
    .prepare("SELECT id, starts_on FROM plans WHERE starts_on = ?")
    .get(startsOn) as unknown as { id: string; starts_on: string } | undefined;

  return row ? { id: row.id, startsOn: row.starts_on } : null;
}

/** The week's plan, created on first write. */
export function getOrCreatePlan(startsOn: string): Plan {
  const existing = getPlan(startsOn);
  if (existing) return existing;

  const id = randomUUID();
  db.prepare("INSERT INTO plans (id, starts_on, created_at) VALUES (?, ?, ?)").run(
    id,
    startsOn,
    new Date().toISOString(),
  );

  return { id, startsOn };
}

export function listPlanEntries(planId: string): PlanEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM plan_entries WHERE plan_id = ?
       ORDER BY day ASC, position ASC, created_at ASC`,
    )
    .all(planId) as unknown as EntryRow[];

  return rows.map(toEntry);
}

export interface AddEntryInput {
  planId: string;
  day: string;
  slot: Slot;
  foodId?: string | null;
  recipeVersionId?: string | null;
  grams?: number | null;
  amount?: number | null;
  unit?: string | null;
  servings?: number | null;
}

export function addPlanEntry(input: AddEntryInput): PlanEntry {
  const isFood = input.foodId != null;
  const isRecipe = input.recipeVersionId != null;

  // The database enforces this too, but failing here gives a message the
  // UI can show instead of a constraint error.
  if (isFood === isRecipe) {
    throw new Error("A plan entry is either a food or a recipe.");
  }

  if (isFood && !(Number.isFinite(input.grams) && (input.grams ?? 0) > 0)) {
    throw new Error("A planned food needs a positive weight.");
  }

  if (isRecipe && !(Number.isFinite(input.servings) && (input.servings ?? 0) > 0)) {
    throw new Error("A planned recipe needs a positive number of servings.");
  }

  const next = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM plan_entries WHERE plan_id = ? AND day = ? AND slot = ?",
    )
    .get(input.planId, input.day, input.slot) as unknown as { position: number };

  const entry: PlanEntry = {
    id: randomUUID(),
    planId: input.planId,
    day: input.day,
    slot: input.slot,
    position: next.position,
    foodId: input.foodId ?? null,
    recipeVersionId: input.recipeVersionId ?? null,
    grams: input.grams ?? null,
    amount: input.amount ?? null,
    unit: input.unit ?? null,
    servings: input.servings ?? null,
  };

  db.prepare(
    `INSERT INTO plan_entries
       (id, plan_id, day, slot, position, food_id, recipe_version_id, grams, amount, unit, servings, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.planId,
    entry.day,
    entry.slot,
    entry.position,
    entry.foodId,
    entry.recipeVersionId,
    entry.grams,
    entry.amount,
    entry.unit,
    entry.servings,
    new Date().toISOString(),
  );

  return entry;
}

/** Change the quantity of an existing entry, leaving what it points at alone. */
export function updatePlanEntryQuantity(
  id: string,
  patch:
    | { grams: number; amount?: number | null; unit?: string | null }
    | { servings: number },
): void {
  const row = db
    .prepare("SELECT food_id, recipe_version_id FROM plan_entries WHERE id = ?")
    .get(id) as unknown as { food_id: string | null; recipe_version_id: string | null } | undefined;

  if (!row) throw new Error("That plan entry no longer exists.");

  if (row.food_id) {
    if (!("grams" in patch) || !Number.isFinite(patch.grams) || patch.grams <= 0) {
      throw new Error("Weight must be a positive number.");
    }
    db.prepare("UPDATE plan_entries SET grams = ?, amount = ?, unit = ? WHERE id = ?").run(
      patch.grams,
      patch.amount ?? null,
      patch.unit ?? null,
      id,
    );
    return;
  }

  if (!("servings" in patch) || !Number.isFinite(patch.servings) || patch.servings <= 0) {
    throw new Error("Servings must be a positive number.");
  }
  db.prepare("UPDATE plan_entries SET servings = ? WHERE id = ?").run(patch.servings, id);
}

/**
 * Move an entry to another day or slot.
 *
 * Only the place changes: the pinned food or recipe version and its
 * quantity stay exactly as they were. The entry goes to the end of the
 * destination, which keeps the existing order stable.
 */
export function movePlanEntry(
  id: string,
  destination: { day: string; slot: Slot },
): PlanEntry {
  const row = db
    .prepare("SELECT * FROM plan_entries WHERE id = ?")
    .get(id) as unknown as EntryRow | undefined;

  if (!row) throw new Error("That plan entry no longer exists.");

  const next = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM plan_entries WHERE plan_id = ? AND day = ? AND slot = ? AND id <> ?",
    )
    .get(row.plan_id, destination.day, destination.slot, id) as unknown as {
    position: number;
  };

  db.prepare("UPDATE plan_entries SET day = ?, slot = ?, position = ? WHERE id = ?").run(
    destination.day,
    destination.slot,
    next.position,
    id,
  );

  return toEntry({
    ...row,
    day: destination.day,
    slot: destination.slot,
    position: next.position,
  });
}

export function removePlanEntry(id: string): void {
  db.prepare("DELETE FROM plan_entries WHERE id = ?").run(id);
}

export function countPlanEntries(planId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM plan_entries WHERE plan_id = ?")
    .get(planId) as unknown as { count: number };
  return row.count;
}
