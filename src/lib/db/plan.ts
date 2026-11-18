import { randomUUID } from "node:crypto";
import { db } from "./client";
import type { PlanEntry, Slot } from "@/lib/plan";

/**
 * Plan persistence.
 *
 * A plan is a week and belongs to one person. Entries reference either a food
 * or a **pinned recipe version**, so correcting a recipe or a food record
 * never rewrites a week that was already planned (D-024, definition of done
 * #4).
 *
 * `plan_entries` has no `person_id`: its plan is the single source of truth,
 * and every query joins through `plans`. Two people may have a plan for the
 * same week; the unique key is `(person_id, starts_on)`.
 */

export interface Plan {
  id: string;
  personId: string;
  startsOn: string;
}

interface PlanRow {
  id: string;
  person_id: string;
  starts_on: string;
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

function toPlan(row: PlanRow): Plan {
  return { id: row.id, personId: row.person_id, startsOn: row.starts_on };
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

/** The person's plan for a week, if it exists, without creating one. */
export function getPlan(personId: string, startsOn: string): Plan | null {
  const row = db
    .prepare(
      "SELECT id, person_id, starts_on FROM plans WHERE person_id = ? AND starts_on = ?",
    )
    .get(personId, startsOn) as unknown as PlanRow | undefined;
  return row ? toPlan(row) : null;
}

/** Resolve a plan only when it belongs to this person. */
export function getPlanForPerson(personId: string, planId: string): Plan | null {
  const row = db
    .prepare("SELECT id, person_id, starts_on FROM plans WHERE id = ? AND person_id = ?")
    .get(planId, personId) as unknown as PlanRow | undefined;
  return row ? toPlan(row) : null;
}

/** The person's plan for the week, created on first write. */
export function getOrCreatePlan(personId: string, startsOn: string): Plan {
  const existing = getPlan(personId, startsOn);
  if (existing) return existing;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO plans (id, person_id, starts_on, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (person_id, starts_on) DO NOTHING`,
  ).run(id, personId, startsOn, new Date().toISOString());

  const created = getPlan(personId, startsOn);
  if (!created) throw new Error("The plan could not be created.");
  return created;
}

/**
 * Entries for one of this person's plans.
 *
 * A foreign or missing plan id returns nothing rather than leaking another
 * diary. The mutating functions below refuse instead.
 */
export function listPlanEntries(personId: string, planId: string): PlanEntry[] {
  const rows = db
    .prepare(
      `SELECT pe.* FROM plan_entries pe
         JOIN plans p ON p.id = pe.plan_id
        WHERE pe.plan_id = ? AND p.person_id = ?
        ORDER BY pe.day ASC, pe.position ASC, pe.created_at ASC`,
    )
    .all(planId, personId) as unknown as EntryRow[];

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

export function addPlanEntry(personId: string, input: AddEntryInput): PlanEntry {
  if (!getPlanForPerson(personId, input.planId)) {
    throw new Error("That plan no longer exists.");
  }

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

/** The person's copy of one plan entry, joined through `plans`. */
function findPlanEntry(personId: string, id: string): EntryRow | null {
  const row = db
    .prepare(
      `SELECT pe.* FROM plan_entries pe
         JOIN plans p ON p.id = pe.plan_id
        WHERE pe.id = ? AND p.person_id = ?`,
    )
    .get(id, personId) as unknown as EntryRow | undefined;
  return row ?? null;
}

/** Change the quantity of an existing entry, leaving what it points at alone. */
export function updatePlanEntryQuantity(
  personId: string,
  id: string,
  patch:
    | { grams: number; amount?: number | null; unit?: string | null }
    | { servings: number },
): void {
  const row = findPlanEntry(personId, id);
  if (!row) throw new Error("That plan entry no longer exists.");

  if (row.food_id) {
    if (!("grams" in patch) || !Number.isFinite(patch.grams) || patch.grams <= 0) {
      throw new Error("Weight must be a positive number.");
    }
    db.prepare(
      `UPDATE plan_entries SET grams = ?, amount = ?, unit = ?
        WHERE id = ? AND plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
    ).run(patch.grams, patch.amount ?? null, patch.unit ?? null, id, personId);
    return;
  }

  if (!("servings" in patch) || !Number.isFinite(patch.servings) || patch.servings <= 0) {
    throw new Error("Servings must be a positive number.");
  }
  db.prepare(
    `UPDATE plan_entries SET servings = ?
      WHERE id = ? AND plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
  ).run(patch.servings, id, personId);
}

/**
 * Move an entry to another day or slot.
 *
 * Only the place changes: the pinned food or recipe version and its
 * quantity stay exactly as they were. The entry goes to the end of the
 * destination, which keeps the existing order stable.
 */
export function movePlanEntry(
  personId: string,
  id: string,
  destination: { day: string; slot: Slot },
): PlanEntry {
  const row = findPlanEntry(personId, id);
  if (!row) throw new Error("That plan entry no longer exists.");

  const next = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM plan_entries WHERE plan_id = ? AND day = ? AND slot = ? AND id <> ?",
    )
    .get(row.plan_id, destination.day, destination.slot, id) as unknown as {
    position: number;
  };

  db.prepare(
    `UPDATE plan_entries SET day = ?, slot = ?, position = ?
      WHERE id = ? AND plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
  ).run(destination.day, destination.slot, next.position, id, personId);

  return toEntry({
    ...row,
    day: destination.day,
    slot: destination.slot,
    position: next.position,
  });
}

export function removePlanEntry(personId: string, id: string): void {
  const result = db
    .prepare(
      `DELETE FROM plan_entries
        WHERE id = ? AND plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
    )
    .run(id, personId);
  if (result.changes === 0) throw new Error("That plan entry no longer exists.");
}

export function countPlanEntries(personId: string, planId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM plan_entries pe
         JOIN plans p ON p.id = pe.plan_id
        WHERE pe.plan_id = ? AND p.person_id = ?`,
    )
    .get(planId, personId) as unknown as { count: number };
  return row.count;
}

/** Household-wide count for one person's plans; used by person deletion. */
export function countPlanEntriesForPerson(personId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM plan_entries
        WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
    )
    .get(personId) as unknown as { count: number };
  return row.count;
}
