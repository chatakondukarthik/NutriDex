import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The household migration.
 *
 * These cases build the pre-household schema directly, boot the current
 * client, and assert the promises the design makes: the existing profile,
 * diary, plans and pins survive; target rules move to the person; the marker
 * is written; the snapshot exists; a second boot changes nothing.
 */

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nutriplan-household-"));
  dirs.push(dir);
  return dir;
}

async function loadClient(dbPath: string) {
  vi.stubEnv("NUTRIPLAN_DB_PATH", dbPath);
  vi.stubEnv("NUTRIPLAN_DATA_DIR", path.dirname(dbPath));
  vi.resetModules();
  delete (globalThis as { __nutriplanDb?: unknown }).__nutriplanDb;
  return await import("@/lib/db/client");
}

function seedLegacy(dbPath: string) {
  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE profile (
      id               TEXT PRIMARY KEY,
      sex              TEXT NOT NULL,
      age_years        REAL NOT NULL,
      height_cm        REAL NOT NULL,
      weight_kg        REAL NOT NULL,
      activity         TEXT NOT NULL,
      goal             TEXT NOT NULL,
      body_fat_percent REAL,
      pace             TEXT NOT NULL DEFAULT 'steady',
      target_weight_kg REAL,
      updated_at       TEXT NOT NULL
    );
    CREATE TABLE entries (
      id                TEXT PRIMARY KEY,
      food_id           TEXT,
      recipe_version_id TEXT,
      grams             REAL NOT NULL,
      amount            REAL NOT NULL,
      unit              TEXT NOT NULL,
      day               TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      CHECK ((food_id IS NOT NULL) <> (recipe_version_id IS NOT NULL))
    );
    CREATE INDEX entries_day_idx ON entries (day, created_at);
    CREATE TABLE plans (
      id         TEXT PRIMARY KEY,
      starts_on  TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE plan_entries (
      id                TEXT PRIMARY KEY,
      plan_id           TEXT NOT NULL REFERENCES plans (id),
      day               TEXT NOT NULL,
      slot              TEXT NOT NULL,
      position          INTEGER NOT NULL,
      food_id           TEXT,
      recipe_version_id TEXT,
      grams             REAL,
      amount            REAL,
      unit              TEXT,
      servings          REAL,
      created_at        TEXT NOT NULL,
      CHECK ((food_id IS NOT NULL) <> (recipe_version_id IS NOT NULL))
    );
    CREATE TABLE food_default_amounts (
      food_id    TEXT PRIMARY KEY,
      amount     REAL NOT NULL,
      unit       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE captured_foods (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      aliases           TEXT NOT NULL DEFAULT '[]',
      category          TEXT,
      kind              TEXT NOT NULL DEFAULT 'provisional',
      state             TEXT NOT NULL DEFAULT 'raw',
      density_g_ml      REAL,
      basis             TEXT,
      serving_size_g    REAL,
      servings_per_pack REAL,
      source            TEXT NOT NULL DEFAULT 'manual',
      source_code       TEXT,
      image_path        TEXT,
      confidence        REAL,
      created_by        TEXT NOT NULL DEFAULT 'local',
      created_at        TEXT NOT NULL,
      archived_at       TEXT
    );
  `);

  const now = "2026-11-18T10:00:00.000Z";
  raw.prepare(
    `INSERT INTO profile
       (id, sex, age_years, height_cm, weight_kg, activity, goal, pace, updated_at)
     VALUES ('local', 'female', 34, 162, 58, 'light', 'lose', 'gentle', ?)`,
  ).run(now);
  raw.prepare(
    `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
     VALUES ('e1', 'paneer', 100, 100, 'g', '2026-11-18', ?)`,
  ).run(now);
  raw.prepare(`INSERT INTO plans (id, starts_on, created_at) VALUES ('p1', '2026-11-16', ?)`).run(
    now,
  );
  raw.prepare(
    `INSERT INTO plan_entries
       (id, plan_id, day, slot, position, food_id, grams, amount, unit, created_at)
     VALUES ('pe1', 'p1', '2026-11-18', 'lunch', 0, 'paneer', 150, 150, 'g', ?)`,
  ).run(now);
  raw.prepare(
    `INSERT INTO food_default_amounts (food_id, amount, unit, updated_at)
     VALUES ('paneer', 150, 'g', ?)`,
  ).run(now);
  raw.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('target_rules', ?)`,
  ).run(JSON.stringify({ overrides: {} }));
  raw.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('ai_master_prompt', 'Keep it simple.')`,
  ).run();
  raw.prepare(
    `INSERT INTO captured_foods (id, name, created_at) VALUES ('cf1', 'Poha', ?)`,
  ).run(now);
  raw.close();
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { __nutriplanDb?: unknown }).__nutriplanDb;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("legacy database upgrade", () => {
  it("moves the single person, diary, plan, pins and target rules without loss", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "test.sqlite");
    seedLegacy(dbPath);

    const client = await loadClient(dbPath);
    const db = client.db;

    const people = db.prepare("SELECT * FROM people").all() as Array<{
      id: string;
      display_name: string;
      archived_at: string | null;
    }>;
    expect(people).toHaveLength(1);
    expect(people[0].display_name).toBe("Me");
    expect(people[0].archived_at).toBeNull();
    const personId = people[0].id;
    expect(personId).not.toBe("local");

    expect(db.prepare("SELECT COUNT(*) AS n FROM households").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT id, target_energy_kcal FROM profile").get()).toEqual({
      id: personId,
      target_energy_kcal: null,
    });
    expect(db.prepare("SELECT person_id FROM entries WHERE id = 'e1'").get()).toEqual({
      person_id: personId,
    });
    expect(db.prepare("SELECT person_id FROM plans WHERE id = 'p1'").get()).toEqual({
      person_id: personId,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM plan_entries WHERE id = 'pe1'").get()).toEqual({
      n: 1,
    });
    expect(
      db.prepare("SELECT person_id, amount FROM food_default_amounts WHERE food_id = 'paneer'").get(),
    ).toEqual({ person_id: personId, amount: 150 });
    expect(
      db.prepare("SELECT value FROM person_settings WHERE person_id = ? AND key = 'target_rules'").get(
        personId,
      ),
    ).toBeDefined();
    expect(
      db.prepare("SELECT 1 AS present FROM app_settings WHERE key = 'target_rules'").get(),
    ).toBeUndefined();
    expect(db.prepare("SELECT created_by FROM captured_foods WHERE id = 'cf1'").get()).toEqual({
      created_by: personId,
    });
    const foodColumns = (
      db
        .prepare("PRAGMA table_info(captured_foods)")
        .all() as unknown as Array<{ name: string }>
    ).map((column) => column.name);
    expect(foodColumns).toContain("source_kind");
    expect(foodColumns).toContain("source_published");
    expect(db.prepare("SELECT version FROM schema_migrations").all()).toEqual([{ version: 1 }]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'entries'")
      .all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toContain("entries_person_day_idx");

    const snapshots = readdirSync(dir).filter((name) =>
      name.startsWith("test.sqlite.pre-household-"),
    );
    expect(snapshots).toHaveLength(1);
    expect(statSync(path.join(dir, snapshots[0])).mode & 0o777).toBe(0o600);
  });

  it("is stable on a second boot and does not take another snapshot", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "test.sqlite");
    seedLegacy(dbPath);

    const first = await loadClient(dbPath);
    const personId = (
      first.db.prepare("SELECT id FROM people").get() as unknown as { id: string }
    ).id;
    first.db.close();

    const second = await loadClient(dbPath);
    expect(second.db.prepare("SELECT id FROM people").all()).toEqual([{ id: personId }]);
    expect(second.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 1 });
    expect(
      readdirSync(dir).filter((name) => name.startsWith("test.sqlite.pre-household-")),
    ).toHaveLength(1);
    second.db.close();
  });

  it("refuses an ambiguous database that has a roster but no marker", async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, "test.sqlite");
    seedLegacy(dbPath);

    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE households (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE people (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
    `);
    raw.prepare(
      "INSERT INTO households (id, name, created_at, updated_at) VALUES ('h', 'Home', 'now', 'now')",
    ).run();
    raw.prepare(
      "INSERT INTO people (id, household_id, display_name, created_at) VALUES ('p', 'h', 'Me', 'now')",
    ).run();
    raw.close();

    await expect(loadClient(dbPath)).rejects.toThrow(/ambiguous/i);
  });
});

describe("fresh install", () => {
  it("creates one household and one person", async () => {
    const dir = tempDir();
    const client = await loadClient(path.join(dir, "test.sqlite"));
    expect(client.db.prepare("SELECT COUNT(*) AS n FROM households").get()).toEqual({ n: 1 });
    const people = client.db.prepare("SELECT display_name FROM people").all();
    expect(people).toEqual([{ display_name: "Me" }]);
    const foodColumns = (
      client.db
        .prepare("PRAGMA table_info(captured_foods)")
        .all() as unknown as Array<{ name: string }>
    ).map((column) => column.name);
    expect(foodColumns).toContain("source_kind");
    expect(foodColumns).toContain("source_published");
    expect(client.db.prepare("SELECT version FROM schema_migrations").all()).toEqual([
      { version: 1 },
    ]);
  });
});
