import { randomUUID } from "node:crypto";
import { db, ensureHousehold as ensureHouseholdRows, transaction } from "./client";

/**
 * The household roster (D-051).
 *
 * People are convenience scopes, not accounts. There is no password, role or
 * ownership check here: anyone at the device can switch to anyone. The only
 * invariants are that a household exists, at least one person exists, and the
 * last active person cannot be archived or deleted out from under the app.
 */

export interface Household {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  householdId: string;
  displayName: string;
  createdAt: string;
  archivedAt: string | null;
}

interface HouseholdRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface PersonRow {
  id: string;
  household_id: string;
  display_name: string;
  created_at: string;
  archived_at: string | null;
}

function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    householdId: row.household_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

function normaliseName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("A person needs a name.");
  if (name.length > 60) throw new Error("A person's name must be 60 characters or fewer.");
  return name;
}

export function ensureHousehold(): void {
  ensureHouseholdRows(db);
}

export function getHousehold(): Household {
  let row = db
    .prepare("SELECT id, name, created_at, updated_at FROM households ORDER BY created_at ASC, rowid ASC LIMIT 1")
    .get() as unknown as HouseholdRow | undefined;

  if (!row) {
    ensureHouseholdRows(db);
    row = db
      .prepare(
        "SELECT id, name, created_at, updated_at FROM households ORDER BY created_at ASC, rowid ASC LIMIT 1",
      )
      .get() as unknown as HouseholdRow;
  }

  return toHousehold(row);
}

export function listPeople(options: { includeArchived?: boolean } = {}): Person[] {
  const rows = db
    .prepare(
      `SELECT * FROM people
        ${options.includeArchived ? "" : "WHERE archived_at IS NULL"}
        ORDER BY archived_at IS NOT NULL ASC, created_at ASC, rowid ASC`,
    )
    .all() as unknown as PersonRow[];
  return rows.map(toPerson);
}

export function getPerson(id: string): Person | null {
  const row = db.prepare("SELECT * FROM people WHERE id = ?").get(id) as unknown as
    | PersonRow
    | undefined;
  return row ? toPerson(row) : null;
}

export function countPeople(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM people").get() as unknown as { n: number }).n;
}

export function countActivePeople(): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM people WHERE archived_at IS NULL").get() as unknown as {
      n: number;
    }
  ).n;
}

/**
 * The person the app opens as when no valid cookie is present.
 *
 * An active person always exists after boot. The archived fallback exists for
 * a database repaired by hand; it is better to open someone than to crash.
 */
export function defaultPersonId(): string {
  const active = db
    .prepare(
      "SELECT id FROM people WHERE archived_at IS NULL ORDER BY created_at ASC, rowid ASC LIMIT 1",
    )
    .get() as unknown as { id: string } | undefined;
  if (active) return active.id;

  const any = db
    .prepare("SELECT id FROM people ORDER BY created_at ASC, rowid ASC LIMIT 1")
    .get() as unknown as { id: string } | undefined;
  if (any) return any.id;

  // The boot invariant should have prevented this. Repair rather than fail.
  ensureHouseholdRows(db);
  const repaired = db
    .prepare("SELECT id FROM people ORDER BY created_at ASC, rowid ASC LIMIT 1")
    .get() as unknown as { id: string } | undefined;
  if (!repaired) throw new Error("The household has no people.");
  return repaired.id;
}

export function createPerson(input: { displayName: string }): Person {
  const household = getHousehold();
  const id = randomUUID();
  const now = new Date().toISOString();
  const displayName = normaliseName(input.displayName);
  db.prepare(
    `INSERT INTO people (id, household_id, display_name, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, household.id, displayName, now);
  return {
    id,
    householdId: household.id,
    displayName,
    createdAt: now,
    archivedAt: null,
  };
}

export function updatePerson(id: string, patch: { displayName?: string }): Person {
  const person = getPerson(id);
  if (!person) throw new Error("That person no longer exists.");
  if (patch.displayName !== undefined) {
    db.prepare("UPDATE people SET display_name = ? WHERE id = ?").run(
      normaliseName(patch.displayName),
      id,
    );
  }
  return getPerson(id) as Person;
}

export function archivePerson(id: string): void {
  const person = getPerson(id);
  if (!person) throw new Error("That person no longer exists.");
  if (person.archivedAt) return;
  if (countActivePeople() <= 1) {
    throw new Error("The last active person cannot be archived. Add or activate someone else first.");
  }
  db.prepare("UPDATE people SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function unarchivePerson(id: string): void {
  const person = getPerson(id);
  if (!person) throw new Error("That person no longer exists.");
  if (!person.archivedAt) return;
  db.prepare("UPDATE people SET archived_at = NULL WHERE id = ?").run(id);
}

/**
 * Remove a person and every row scoped to them. Shared recipes, foods and
 * evidence are untouched: they belong to the household.
 *
 * The last active person is protected. Deactivating is the default elsewhere;
 * this is the explicit hard-delete path, so it is separate from the purge.
 */
export function deletePerson(id: string): void {
  const person = getPerson(id);
  if (!person) throw new Error("That person no longer exists.");
  if (countPeople() <= 1) {
    throw new Error("The only person in the household cannot be deleted.");
  }
  if (!person.archivedAt && countActivePeople() <= 1) {
    throw new Error("The last active person cannot be deleted. Add or activate someone else first.");
  }

  transaction(() => {
    db.prepare(
      "DELETE FROM plan_entries WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)",
    ).run(id);
    db.prepare("DELETE FROM plans WHERE person_id = ?").run(id);
    db.prepare("DELETE FROM entries WHERE person_id = ?").run(id);
    db.prepare("DELETE FROM food_default_amounts WHERE person_id = ?").run(id);
    db.prepare("DELETE FROM person_settings WHERE person_id = ?").run(id);
    db.prepare("DELETE FROM profile WHERE id = ?").run(id);
    db.prepare("DELETE FROM people WHERE id = ?").run(id);
  });
}

/** Counts shown before a hard delete, so the confirmation is honest. */
export interface PersonDeletionCounts {
  diaryEntries: number;
  plans: number;
  planEntries: number;
  pins: number;
}

export function personDeletionCounts(id: string): PersonDeletionCounts {
  const n = (sql: string) =>
    (db.prepare(sql).get(id) as unknown as { n: number }).n;
  return {
    diaryEntries: n("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?"),
    plans: n("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?"),
    planEntries: n(
      `SELECT COUNT(*) AS n FROM plan_entries
        WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
    ),
    pins: n("SELECT COUNT(*) AS n FROM food_default_amounts WHERE person_id = ?"),
  };
}
