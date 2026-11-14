import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Local persistence.
 *
 * Node 26 ships SQLite, so there is no native dependency and no service
 * to run. This is deliberately a thin layer: when the app moves to
 * Postgres for deployment, only this file and the queries change.
 */
const globalForDb = globalThis as unknown as { __nutriplanDb?: DatabaseSync };

function resolveDbPath(): string {
  // NUTRIPLAN_DB_PATH exists so tests can point at a throwaway file.
  return (
    process.env.NUTRIPLAN_DB_PATH ??
    path.join(process.cwd(), "data", "nutriplan.sqlite")
  );
}

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS entries (
    id          TEXT PRIMARY KEY,
    food_id     TEXT NOT NULL,
    grams       REAL NOT NULL,
    amount      REAL NOT NULL,
    unit        TEXT NOT NULL,
    day         TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS entries_day_idx ON entries (day, created_at);

  CREATE TABLE IF NOT EXISTS recipes (
    id                 TEXT PRIMARY KEY,
    kind               TEXT NOT NULL DEFAULT 'dish',
    name               TEXT NOT NULL,
    current_version_id TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recipe_versions (
    id                  TEXT PRIMARY KEY,
    recipe_id           TEXT NOT NULL REFERENCES recipes (id),
    version_no          INTEGER NOT NULL,
    instructions        TEXT NOT NULL DEFAULT '',
    servings            REAL NOT NULL,
    yield_g             REAL,
    snapshot            TEXT NOT NULL,
    calculation_version TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    UNIQUE (recipe_id, version_no)
  );

  CREATE INDEX IF NOT EXISTS recipe_versions_recipe_idx
    ON recipe_versions (recipe_id, version_no DESC);

  CREATE TABLE IF NOT EXISTS components (
    id                TEXT PRIMARY KEY,
    recipe_version_id TEXT NOT NULL REFERENCES recipe_versions (id),
    position          INTEGER NOT NULL,
    name              TEXT NOT NULL,
    operation         TEXT,
    output_g          REAL
  );

  CREATE INDEX IF NOT EXISTS components_version_idx
    ON components (recipe_version_id, position);

  CREATE TABLE IF NOT EXISTS component_inputs (
    id            TEXT PRIMARY KEY,
    component_id  TEXT NOT NULL REFERENCES components (id),
    position      INTEGER NOT NULL,
    food_id       TEXT NOT NULL,
    grams         REAL NOT NULL,
    amount        REAL NOT NULL,
    unit          TEXT NOT NULL,
    preparation   TEXT,
    note          TEXT
  );

  CREATE INDEX IF NOT EXISTS component_inputs_component_idx
    ON component_inputs (component_id, position);
`;

function createDb(): DatabaseSync {
  const dbPath = resolveDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new DatabaseSync(dbPath);
  database.exec(SCHEMA);

  return database;
}

export const db: DatabaseSync =
  globalForDb.__nutriplanDb ?? (globalForDb.__nutriplanDb = createDb());

/**
 * Run several statements atomically.
 *
 * A recipe save writes a recipe, a version, its components and their
 * inputs. A half-written version would be corrupt in a way that is
 * invisible to the UI, so this cannot be left to chance.
 */
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
