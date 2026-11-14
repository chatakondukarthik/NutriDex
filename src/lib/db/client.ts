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

function createDb(): DatabaseSync {
  const dbPath = resolveDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA journal_mode = WAL;

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
  `);

  return database;
}

export const db: DatabaseSync =
  globalForDb.__nutriplanDb ?? (globalForDb.__nutriplanDb = createDb());
