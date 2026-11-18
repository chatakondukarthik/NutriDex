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
let personBuffer: Buffer;
let personId: string;

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
  const { defaultPersonId } = await import("@/lib/db/people");
  personId = defaultPersonId();

  const now = "2026-11-18T10:00:00.000Z";
  db.prepare(
    `INSERT INTO profile (id, sex, age_years, height_cm, weight_kg, activity, goal, pace, updated_at)
     VALUES (?, 'female', 34, 162, 58, 'light', 'lose', 'gentle', ?)`,
  ).run(personId, now);
  db.prepare(
    `INSERT INTO entries (id, person_id, food_id, grams, amount, unit, day, created_at)
     VALUES ('e1', ?, 'paneer', 100, 100, 'g', '2026-11-18', ?)`,
  ).run(personId, now);
  db.prepare(
    `INSERT INTO plans (id, person_id, starts_on, created_at)
     VALUES ('p1', ?, '2026-11-16', ?)`,
  ).run(personId, now);
  db.prepare(
    `INSERT INTO plan_entries
       (id, plan_id, day, slot, position, food_id, grams, amount, unit, created_at)
     VALUES ('pe1', 'p1', '2026-11-18', 'lunch', 0, 'paneer', 150, 150, 'g', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO food_default_amounts (person_id, food_id, amount, unit, updated_at)
     VALUES (?, 'paneer', 150, 'g', ?)`,
  ).run(personId, now);
  db.prepare(
    `INSERT INTO person_settings (person_id, key, value, updated_at)
     VALUES (?, 'target_rules', '{"amberOver":0.1}', ?)`,
  ).run(personId, now);
  db.prepare(
    `INSERT INTO captured_foods (id, name, aliases, kind, state, source, image_path, created_by, created_at)
     VALUES ('f1', 'Poha', '[]', 'provisional', 'raw', 'manual', 'data/evidence/poha.png', ?, ?)`,
  ).run(personId, now);

  mkdirSync(path.join(sourceDir, "evidence"), { recursive: true });
  writeFileSync(path.join(sourceDir, "evidence", "poha.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]));

  sourceHash = Object.fromEntries(
    TABLES.map((spec) => [spec.table, hashRows(db, spec.table, spec.where)]),
  );
  buffer = buildArchive({ now: new Date(now), includeSnapshot: false }).buffer;
  personBuffer = buildArchive({
    now: new Date(now),
    includeSnapshot: false,
    scope: "person",
    personId,
  }).buffer;
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

  it("restores one person's archive into a fresh installation", async () => {
    const freshDir = mkdtempSync(path.join(tmpdir(), "nutriplan-restore-person-"));
    vi.resetModules();
    delete (globalThis as { __nutriplanDb?: unknown }).__nutriplanDb;
    vi.stubEnv("NUTRIPLAN_DATA_DIR", freshDir);
    vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(freshDir, "nutriplan.sqlite"));

    const { db } = await import("@/lib/db/client");
    try {
      const { importArchive } = await import("@/lib/archive/import");
      const { defaultPersonId } = await import("@/lib/db/people");
      const target = defaultPersonId();

      const report = importArchive(personBuffer, {
        mode: "replace",
        targetPersonId: target,
      });

      expect(report.ok).toBe(true);
      expect(report.scope).toBe("person");
      expect(report.personId).toBe(target);
      expect(report.formatVersion).toBe(2);

      // The archive's person was rewritten onto this installation's person;
      // no second household or person was created.
      expect(db.prepare("SELECT COUNT(*) AS n FROM households").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM people").get()).toEqual({ n: 1 });
      expect(
        db
          .prepare(
            `SELECT sex, age_years, height_cm, weight_kg, activity, goal, pace
               FROM profile WHERE id = ?`,
          )
          .get(target),
      ).toEqual({
        sex: "female",
        age_years: 34,
        height_cm: 162,
        weight_kg: 58,
        activity: "light",
        goal: "lose",
        pace: "gentle",
      });

      expect(
        db.prepare("SELECT food_id, grams FROM entries WHERE person_id = ?").get(target),
      ).toEqual({ food_id: "paneer", grams: 100 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?").get(target)).toEqual({
        n: 1,
      });
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM plan_entries
              WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
          )
          .get(target),
      ).toEqual({ n: 1 });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM food_default_amounts WHERE person_id = ?").get(target),
      ).toEqual({ n: 1 });
      expect(
        db
          .prepare("SELECT value FROM person_settings WHERE person_id = ? AND key = 'target_rules'")
          .get(target),
      ).toEqual({ value: '{"amberOver":0.1}' });

      // The shared library travelled with the person archive.
      expect(db.prepare("SELECT name FROM captured_foods WHERE id = 'f1'").get()).toEqual({
        name: "Poha",
      });
      expect([...readFileSync(path.join(freshDir, "evidence", "poha.png"))]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 9, 8, 7,
      ]);
    } finally {
      db.close();
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});
