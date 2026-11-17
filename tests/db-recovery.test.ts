import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Migration recovery and transaction behaviour.
 *
 * An older build ran the `entries` rebuild in autocommit, so a crash between
 * RENAME and DROP could strand the diary in `entries_v1`. The next boot must
 * finish the copy instead of creating an empty `entries` and returning early.
 * These cases build those on-disk states directly, then boot the client.
 */

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nutriplan-recovery-"));
  dirs.push(dir);
  return path.join(dir, "test.sqlite");
}

async function loadClient(dbPath: string) {
  vi.stubEnv("NUTRIPLAN_DB_PATH", dbPath);
  vi.stubEnv("NUTRIPLAN_DATA_DIR", path.dirname(dbPath));
  vi.resetModules();
  delete (globalThis as { __nutriplanDb?: unknown }).__nutriplanDb;
  return await import("@/lib/db/client");
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { __nutriplanDb?: unknown }).__nutriplanDb;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seedInterruptedRebuild(dbPath: string, newRows: number, oldRows: number) {
  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    CREATE TABLE entries (
      id                TEXT PRIMARY KEY,
      food_id           TEXT,
      recipe_version_id TEXT,
      grams             REAL NOT NULL,
      amount            REAL NOT NULL,
      unit              TEXT NOT NULL,
      day               TEXT NOT NULL,
      created_at        TEXT NOT NULL
    );
    CREATE TABLE entries_v1 (
      id         TEXT PRIMARY KEY,
      food_id    TEXT NOT NULL,
      grams      REAL NOT NULL,
      amount     REAL NOT NULL,
      unit       TEXT NOT NULL,
      day        TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const insert = raw.prepare(
    `INSERT INTO entries_v1 (id, food_id, grams, amount, unit, day, created_at)
     VALUES (?, 'paneer', 100, 1, 'g', '2026-01-01', '2026-01-01T00:00:00.000Z')`,
  );
  for (let i = 0; i < oldRows; i++) insert.run(`old-${i}`);
  const insertNew = raw.prepare(
    `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
     VALUES (?, 'paneer', 100, 1, 'g', '2026-01-01', '2026-01-01T00:00:00.000Z')`,
  );
  for (let i = 0; i < newRows; i++) insertNew.run(`new-${i}`);
  raw.close();
}

describe("interrupted entries rebuild", () => {
  it("finishes the copy and drops the stranded table", async () => {
    const dbPath = tempDb();
    seedInterruptedRebuild(dbPath, 0, 2);

    const client = await loadClient(dbPath);
    const rows = client.db.prepare(`SELECT id FROM entries ORDER BY id`).all() as Array<{
      id: string;
    }>;
    expect(rows.map((row) => row.id)).toEqual(["old-0", "old-1"]);
    expect(
      client.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries_v1'`)
        .get(),
    ).toBeUndefined();
  });

  it("merges a stranded diary when the copy never ran", async () => {
    // Crash after CREATE, before INSERT: the post-crash rows are in `entries`
    // and the pre-crash diary is still in `entries_v1`. Both must survive.
    const dbPath = tempDb();
    seedInterruptedRebuild(dbPath, 2, 2);

    const client = await loadClient(dbPath);
    const rows = client.db.prepare(`SELECT id FROM entries ORDER BY id`).all() as Array<{
      id: string;
    }>;
    expect(rows.map((row) => row.id)).toEqual(["new-0", "new-1", "old-0", "old-1"]);
    expect(
      client.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries_v1'`)
        .get(),
    ).toBeUndefined();
    // The index followed the RENAME and was dropped with entries_v1.
    const indexes = client.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'entries'`)
      .all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toContain("entries_day_idx");
  });

  it("keeps the live table when the copy already ran", async () => {
    // Crash after INSERT, before DROP: every entries_v1 id is already in
    // `entries`, which was the live table afterwards. A later edit must win.
    const dbPath = tempDb();
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE entries (
        id                TEXT PRIMARY KEY,
        food_id           TEXT,
        recipe_version_id TEXT,
        grams             REAL NOT NULL,
        amount            REAL NOT NULL,
        unit              TEXT NOT NULL,
        day               TEXT NOT NULL,
        created_at        TEXT NOT NULL
      );
      CREATE TABLE entries_v1 (
        id         TEXT PRIMARY KEY,
        food_id    TEXT NOT NULL,
        grams      REAL NOT NULL,
        amount     REAL NOT NULL,
        unit       TEXT NOT NULL,
        day        TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO entries_v1 (id, food_id, grams, amount, unit, day, created_at)
        VALUES ('old-0', 'paneer', 100, 1, 'g', '2026-01-01', '2026-01-01T00:00:00.000Z');
      INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
        VALUES ('old-0', 'paneer', 250, 1, 'g', '2026-01-01', '2026-01-01T00:00:00.000Z');
    `);
    raw.close();

    const client = await loadClient(dbPath);
    const rows = client.db.prepare(`SELECT id, grams FROM entries`).all() as Array<{
      id: string;
      grams: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "old-0", grams: 250 });
  });
});

describe("database path", () => {
  it("creates a missing parent for an explicit database path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "nutriplan-dbpath-"));
    dirs.push(root);
    const dbPath = path.join(root, "nested", "deeper", "test.sqlite");

    // The data dir is elsewhere, so this exercises the create-without-chmod
    // branch rather than `ensurePrivateDir`.
    vi.stubEnv("NUTRIPLAN_DB_PATH", dbPath);
    vi.stubEnv("NUTRIPLAN_DATA_DIR", path.join(root, "data"));
    vi.resetModules();
    delete (globalThis as { __nutriplanDb?: unknown }).__nutriplanDb;
    const client = await import("@/lib/db/client");

    expect(client.db.prepare("SELECT 1 AS x").get()).toEqual({ x: 1 });
  });
});

describe("transaction", () => {
  it("takes the write lock up front (BEGIN IMMEDIATE)", async () => {
    const dbPath = tempDb();
    const client = await loadClient(dbPath);

    const other = new DatabaseSync(dbPath);
    other.exec("BEGIN IMMEDIATE");
    client.db.exec("PRAGMA busy_timeout = 50");
    try {
      // A read-only body would succeed under a deferred BEGIN. With
      // BEGIN IMMEDIATE it must fail to acquire the write lock.
      expect(() =>
        client.transaction(() => {
          client.db.prepare("SELECT 1 AS x").get();
        }),
      ).toThrow(/locked|busy/i);
    } finally {
      client.db.exec("PRAGMA busy_timeout = 5000");
      other.exec("ROLLBACK");
      other.close();
    }
  });

  it("rejects an async callback instead of committing early", async () => {
    const client = await loadClient(tempDb());
    expect(() =>
      client.transaction((async () => "late") as unknown as () => string),
    ).toThrow(/synchronous/i);
  });

  it("surfaces the original error when SQLite already rolled back", async () => {
    const client = await loadClient(tempDb());
    expect(() =>
      client.transaction(() => {
        client.db.exec("ROLLBACK");
        throw new Error("original failure");
      }),
    ).toThrow("original failure");
  });
});
