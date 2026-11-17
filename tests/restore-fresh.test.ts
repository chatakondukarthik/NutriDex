import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * R-011 — restore into a genuinely fresh data directory.
 *
 * The existing round-trip test wipes rows and imports back into the same
 * open database. That proves merge/replace semantics, but it does not prove
 * the thing a second machine actually does: create the database, directories
 * and evidence folder from nothing, then import. This test changes the data
 * directory, resets the module cache so every module opens the new file, and
 * compares content hashes across the two installations.
 */

let sourceDir: string;
let targetDir: string;
let sourceHash: Record<string, string>;
let buffer: Buffer;

function hashRows(
  db: { prepare: (sql: string) => { all: () => unknown } },
  table: string,
  where?: string,
): string {
  const rows = db.prepare(`SELECT * FROM ${table}${where ? ` WHERE ${where}` : ""} ORDER BY rowid`).all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

beforeAll(async () => {
  sourceDir = mkdtempSync(path.join(tmpdir(), "nutriplan-restore-source-"));
  targetDir = mkdtempSync(path.join(tmpdir(), "nutriplan-restore-target-"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", sourceDir);
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(sourceDir, "nutriplan.sqlite"));

  const { db } = await import("@/lib/db/client");
  const { buildArchive } = await import("@/lib/archive/export");
  const { TABLES } = await import("@/lib/archive/registry");

  const now = "2026-11-18T10:00:00.000Z";
  db.prepare(
    `INSERT INTO profile (id, sex, age_years, height_cm, weight_kg, activity, goal, pace, updated_at)
     VALUES ('local', 'female', 34, 162, 58, 'light', 'lose', 'gentle', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
     VALUES ('e1', 'paneer', 100, 100, 'g', '2026-11-18', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO captured_foods (id, name, aliases, kind, state, source, image_path, created_at)
     VALUES ('f1', 'Poha', '[]', 'provisional', 'raw', 'manual', 'data/evidence/poha.png', ?)`,
  ).run(now);

  mkdirSync(path.join(sourceDir, "evidence"), { recursive: true });
  writeFileSync(path.join(sourceDir, "evidence", "poha.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]));

  sourceHash = Object.fromEntries(
    TABLES.map((spec) => [spec.table, hashRows(db, spec.table, spec.where)]),
  );
  buffer = buildArchive({ now: new Date(now), includeSnapshot: false }).buffer;
  db.close();
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
});

describe("restore on a fresh installation", () => {
  it("creates the database, schema and evidence from nothing", async () => {
    expect(existsSync(path.join(targetDir, "nutriplan.sqlite"))).toBe(false);
    expect(existsSync(path.join(targetDir, "evidence"))).toBe(false);

    vi.resetModules();
    // The database handle is cached on `globalThis` so hot reload does not
    // reopen it. A new installation must not inherit the old handle.
    delete (globalThis as { __nutriplanDb?: unknown }).__nutriplanDb;
    vi.stubEnv("NUTRIPLAN_DATA_DIR", targetDir);
    vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(targetDir, "nutriplan.sqlite"));

    const { db } = await import("@/lib/db/client");
    const { importArchive } = await import("@/lib/archive/import");
    const { TABLES } = await import("@/lib/archive/registry");

    const report = importArchive(buffer, { mode: "replace" });
    expect(report.ok).toBe(true);
    expect(report.files.written).toBe(1);

    expect(existsSync(path.join(targetDir, "nutriplan.sqlite"))).toBe(true);
    expect([...readFileSync(path.join(targetDir, "evidence", "poha.png"))]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 9, 8, 7,
    ]);

    for (const spec of TABLES) {
      expect(hashRows(db, spec.table, spec.where), spec.table).toBe(sourceHash[spec.table]);
    }

    db.close();
  });
});
