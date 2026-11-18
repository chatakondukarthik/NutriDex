import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Total export / total import, now household-scoped.
 *
 * The acceptance test is still the one the security tracker names: export,
 * wipe, import, compare. It runs against a throwaway database with a row in
 * every exported table, and compares a content hash per table rather than
 * just counts — a count match with different values is the failure this is
 * meant to catch.
 *
 * Version 2 adds scopes, so the tests also prove the three shapes do not
 * leak into each other: a person archive carries exactly one person and the
 * shared library; a shared archive carries no people; a household archive
 * carries everyone.
 */

const NOW = "2026-11-17T10:00:00.000Z";

let dir: string;
let archive: typeof import("@/lib/archive/export");
let importer: typeof import("@/lib/archive/import");
let dbModule: typeof import("@/lib/db/client");
let db: typeof import("@/lib/db/client")["db"];
let TABLES: typeof import("@/lib/archive/registry")["TABLES"];
let people: typeof import("@/lib/db/people");
let writeZip: typeof import("@/lib/archive/zip")["writeZip"];
let readZip: typeof import("@/lib/archive/zip")["readZip"];
let assertSafeEntryName: typeof import("@/lib/archive/zip")["assertSafeEntryName"];
let manifestPath: string;
let personId: string;

const WHERE: Record<string, string> = {
  retention_factors: "origin = 'user'",
  app_settings: "key = 'ai_master_prompt'",
  person_settings: "key = 'target_rules'",
};

function specFor(table: string) {
  return TABLES.find((spec) => spec.table === table)!;
}

function hashTable(table: string): string {
  const where = WHERE[table] ?? specFor(table).where;
  const clause = where ? ` WHERE ${where}` : "";
  const rows = db.prepare(`SELECT * FROM ${table}${clause} ORDER BY rowid`).all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function counts(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const spec of TABLES) {
    const where = spec.where ? ` WHERE ${spec.where}` : "";
    result[spec.table] = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table}${where}`).get() as unknown as { n: number }
    ).n;
  }
  return result;
}

/**
 * Delete every exported row, children first. The roster is content here: a
 * household replace must restore it, and a person replace must leave it be.
 */
function wipe(): void {
  for (const spec of [...TABLES].reverse()) {
    // `app_settings` has an export predicate, not a wipe predicate: a test may
    // have inserted a key the importer refuses, and that must not leak into
    // the next fixture.
    if (spec.table === "app_settings") {
      db.exec("DELETE FROM app_settings");
    } else {
      db.exec(spec.where ? `DELETE FROM ${spec.table} WHERE ${spec.where}` : `DELETE FROM ${spec.table}`);
    }
  }
}

/** Seed one person's diary, plan, body profile, pins and thresholds. */
function seedPerson(id: string, suffix: string): void {
  db.prepare(
    `INSERT INTO profile (id, sex, age_years, height_cm, weight_kg, activity, goal, pace, updated_at)
     VALUES (?, 'male', 30, 175, 70, 'moderate', 'maintain', 'steady', ?)`,
  ).run(id, NOW);

  db.prepare(
    `INSERT INTO plans (id, person_id, starts_on, created_at)
     VALUES (?, ?, '2026-11-16', ?)`,
  ).run(`p-${suffix}`, id, NOW);
  db.prepare(
    `INSERT INTO plan_entries (id, plan_id, day, slot, position, recipe_version_id, servings, created_at)
     VALUES (?, ?, '2026-11-16', 'lunch', 0, 'v1', 1, ?)`,
  ).run(`pe-${suffix}`, `p-${suffix}`, NOW);
  db.prepare(
    `INSERT INTO entries (id, person_id, food_id, grams, amount, unit, day, created_at)
     VALUES (?, ?, 'paneer', 100, 100, 'g', '2026-11-16', ?)`,
  ).run(`e-${suffix}`, id, NOW);
  db.prepare(
    `INSERT INTO food_default_amounts (person_id, food_id, amount, unit, updated_at)
     VALUES (?, 'f1', 1, 'katori', ?)`,
  ).run(id, NOW);
  db.prepare(
    `INSERT INTO person_settings (person_id, key, value, updated_at)
     VALUES (?, 'target_rules', '{"amberOver":0.1}', ?)`,
  ).run(id, NOW);
}

/** Add a person without personal rows, for scope-filter tests. */
function addOtherPerson(name = "Priya"): string {
  return people.createPerson({ displayName: name }).id;
}

function seedShared(): void {
  db.prepare(
    `INSERT INTO recipes (id, kind, name, current_version_id, created_at, updated_at)
     VALUES ('r1', 'dish', 'Dal', 'v1', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO recipe_versions (id, recipe_id, version_no, instructions, servings, yield_g,
       snapshot, calculation_version, label, created_at)
     VALUES ('v1', 'r1', 1, 'Boil, then temper.', 2, 500, ?, '2', 'trial', ?)`,
  ).run(JSON.stringify({ v: 2, totals: { energy_kcal: 420 } }), NOW);
  db.prepare(
    `INSERT INTO components (id, recipe_version_id, position, name, operation, output_g)
     VALUES ('c1', 'v1', 0, 'Base', 'boil', 500)`,
  ).run();
  db.prepare(
    `INSERT INTO component_inputs (id, component_id, position, food_id, grams, amount, unit, preparation, note)
     VALUES ('i1', 'c1', 0, 'paneer', 100, 100, 'g', 'diced', 'from the corner shop')`,
  ).run();

  db.prepare(
    `INSERT INTO captured_foods
       (id, name, aliases, kind, state, source, source_kind, source_published, image_path, created_by, created_at)
     VALUES ('f1', 'Poha', '["pohaa"]', 'provisional', 'raw', 'indb', 'indb', '2019', 'data/evidence/poha.png', ?, ?)`,
  ).run(personId, NOW);
  db.prepare(
    `INSERT INTO captured_food_nutrients (food_id, nutrient, amount, status)
     VALUES ('f1', 'energy_kcal', 130, 'measured')`,
  ).run();
  db.prepare(
    `INSERT INTO captured_food_portions (id, food_id, label, grams, source)
     VALUES ('pp1', 'f1', 'katori', 150, 'label')`,
  ).run();

  db.prepare(
    `INSERT INTO retention_factors (id, operation, qualifier, nutrient, factor, source, notes, origin)
     VALUES ('rf1', 'pressure-cook', NULL, 'vitamin_c', 0.6, 'user', 'own measurement', 'user')`,
  ).run();

  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('ai_master_prompt', 'South Indian home food.')`,
  ).run();

  db.prepare(
    `INSERT INTO ai_calls (id, provider, model, capability, status, created_at)
     VALUES ('a1', 'openai', 'gpt-x', 'estimate', 'ok', ?)`,
  ).run(NOW);
}

function seed(): void {
  seedShared();
  seedPerson(personId, "1");
  // A pin for a seed food, separate from the captured-food pin above.
  db.prepare(
    `INSERT INTO food_default_amounts (person_id, food_id, amount, unit, updated_at)
     VALUES (?, 'paneer', 100, 'g', ?)`,
  ).run(personId, NOW);
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-archive-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);

  archive = await import("@/lib/archive/export");
  importer = await import("@/lib/archive/import");
  dbModule = await import("@/lib/db/client");
  db = dbModule.db;
  ({ TABLES } = await import("@/lib/archive/registry"));
  people = await import("@/lib/db/people");
  ({ writeZip, readZip, assertSafeEntryName } = await import("@/lib/archive/zip"));
  ({ MANIFEST_PATH: manifestPath } = await import("@/lib/archive/manifest"));

  mkdirSync(path.join(dir, "evidence"), { recursive: true });
  writeFileSync(path.join(dir, "evidence", "poha.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  wipe();
  db.exec("DELETE FROM meta");
  people.ensureHousehold();
  personId = people.defaultPersonId();
  seed();
});

/* ------------------------------------------------------------------ */
/* ZIP helpers                                                        */
/* ------------------------------------------------------------------ */

function rebuild(
  buffer: Buffer,
  mutate: (entries: Array<{ name: string; data: Buffer }>, manifest: Record<string, unknown>) => void,
): Buffer {
  const files = readZip(buffer);
  const manifest = JSON.parse(files.get(manifestPath)!.toString("utf8")) as Record<string, unknown>;
  const entries = [...files.entries()]
    .filter(([name]) => name !== manifestPath)
    .map(([name, data]) => ({ name, data }));
  mutate(entries, manifest);
  return writeZip([
    { name: manifestPath, data: Buffer.from(JSON.stringify(manifest), "utf8") },
    ...entries,
  ]);
}

/** Rewrite one NDJSON entry and keep the manifest checksum honest. */
function rewriteEntry(
  entries: Array<{ name: string; data: Buffer }>,
  manifest: Record<string, unknown>,
  name: string,
  change: (rows: Array<Record<string, unknown>>) => void,
): void {
  const target = entries.find((entry) => entry.name === name)!;
  const rows = target.data
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  change(rows);
  target.data = Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");

  const listed = (
    manifest.files as Array<{ path: string; sha256: string; bytes: number }>
  ).find((file) => file.path === name)!;
  listed.sha256 = createHash("sha256").update(target.data).digest("hex");
  listed.bytes = target.data.length;
}

function rowsOf(buffer: Buffer, table: string): Array<Record<string, unknown>> {
  const data = readZip(buffer).get(`data/${table}.ndjson`);
  if (!data || data.length === 0) return [];
  return data
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Turn a v2 person archive into a v1 archive: no household, no people, no
 * `person_settings`, and `target_rules` back in `app_settings`.
 */
function toV1(buffer: Buffer): Buffer {
  const files = readZip(buffer);
  const manifest = JSON.parse(files.get(manifestPath)!.toString("utf8")) as Record<string, unknown>;
  const entries = [...files.entries()]
    .filter(([name]) => name !== manifestPath)
    .map(([name, data]) => ({ name, data }));

  for (const table of ["households", "people", "person_settings"]) {
    const name = `data/${table}.ndjson`;
    const index = entries.findIndex((entry) => entry.name === name);
    if (index >= 0) entries.splice(index, 1);
    manifest.files = (manifest.files as Array<{ path: string }>).filter(
      (file) => file.path !== name,
    );
    delete (manifest.counts as Record<string, number>)[table];
    delete (manifest.columns as Record<string, string[]>)[table];
  }

  rewriteEntry(entries, manifest, "data/app_settings.ndjson", (rows) => {
    rows.push({ key: "target_rules", value: '{"amberOver":0.1}' });
  });
  (manifest.counts as Record<string, number>).app_settings = 2;

  manifest.formatVersion = 1;
  delete manifest.scope;
  delete manifest.householdId;
  delete manifest.personId;
  manifest.includes = { ...(manifest.includes as Record<string, unknown>), snapshot: false };

  return writeZip([
    { name: manifestPath, data: Buffer.from(JSON.stringify(manifest), "utf8") },
    ...entries,
  ]);
}

/**
 * Re-key a household archive as if it came from another installation.
 *
 * Personal ids are unique to their installation, so a real foreign archive
 * would not collide. Shared ids stay put: the shared library merges by
 * identity.
 */
function toForeignHousehold(buffer: Buffer): Buffer {
  const householdId = "h-foreign";
  const person = "p-foreign";
  const plan = "plan-foreign";
  return rebuild(buffer, (entries, manifest) => {
    rewriteEntry(entries, manifest, "data/households.ndjson", (rows) => {
      rows[0].id = householdId;
    });
    rewriteEntry(entries, manifest, "data/people.ndjson", (rows) => {
      rows[0].id = person;
      rows[0].household_id = householdId;
    });
    rewriteEntry(entries, manifest, "data/profile.ndjson", (rows) => {
      rows[0].id = person;
    });
    rewriteEntry(entries, manifest, "data/plans.ndjson", (rows) => {
      rows[0].id = plan;
      rows[0].person_id = person;
    });
    rewriteEntry(entries, manifest, "data/plan_entries.ndjson", (rows) => {
      rows[0].id = "plan-entry-foreign";
      rows[0].plan_id = plan;
    });
    rewriteEntry(entries, manifest, "data/entries.ndjson", (rows) => {
      rows[0].id = "entry-foreign";
      rows[0].person_id = person;
    });
    for (const table of ["food_default_amounts", "person_settings"]) {
      rewriteEntry(entries, manifest, `data/${table}.ndjson`, (rows) => {
        for (const row of rows) row.person_id = person;
      });
    }
    manifest.householdId = householdId;
  });
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

describe("export", () => {
  it("includes every user table, evidence and a manifest", () => {
    const { buffer, manifest } = archive.buildArchive({ now: new Date("2026-11-17T12:00:00Z") });
    const files = readZip(buffer);

    expect(files.has(manifestPath)).toBe(true);
    expect(files.has("snapshot.sqlite")).toBe(true);
    expect(files.has("README.txt")).toBe(true);
    expect(files.has("files/evidence/poha.png")).toBe(true);

    for (const spec of TABLES) {
      if (spec.table === "ai_calls") continue;
      expect(files.has(`data/${spec.table}.ndjson`), spec.table).toBe(true);
    }

    expect(manifest.formatVersion).toBe(2);
    expect(manifest.scope).toBe("household");
    expect(manifest.personId).toBeNull();
    expect(manifest.counts.entries).toBe(1);
    expect(manifest.counts.people).toBe(1);
    expect(manifest.counts.recipe_versions).toBe(1);
    expect(manifest.includes.secrets).toBe(false);
    expect(manifest.includes.aiCalls).toBe(false);
    // The AI log is operational, not content: opt-in only.
    expect(files.has("data/ai_calls.ndjson")).toBe(false);
  });

  it("never contains secrets.json", () => {
    const { buffer } = archive.buildArchive();
    for (const name of readZip(buffer).keys()) {
      expect(name).not.toContain("secrets");
    }
  });

  it("copies a shared evidence image once", () => {
    db.prepare(
      `INSERT INTO captured_foods (id, name, aliases, kind, state, source, image_path, created_by, created_at)
       VALUES ('f2', 'Poha (leftovers)', '[]', 'provisional', 'raw', 'manual', 'data/evidence/poha.png', ?, ?)`,
    ).run(personId, NOW);

    const { buffer, manifest } = archive.buildArchive();
    const names = [...readZip(buffer).keys()].filter((name) => name.startsWith("files/"));
    expect(names).toEqual(["files/evidence/poha.png"]);
    expect(manifest.files.filter((file) => file.path === "files/evidence/poha.png")).toHaveLength(1);
  });

  it("never exports the app-managed retention origin", () => {
    const { buffer, manifest } = archive.buildArchive();
    expect(manifest.columns.retention_factors).not.toContain("origin");

    const rows = readZip(buffer)
      .get("data/retention_factors.ndjson")!
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("origin");
  });

  it("scrubs the AI log from the snapshot unless it was requested", () => {
    const { buffer } = archive.buildArchive({ includeSnapshot: true });
    const snapshot = readZip(buffer).get("snapshot.sqlite");
    expect(snapshot).toBeDefined();

    const snapshotPath = path.join(dir, "snapshot-check.sqlite");
    writeFileSync(snapshotPath, snapshot!);
    const copy = new DatabaseSync(snapshotPath);
    try {
      const calls = copy.prepare("SELECT COUNT(*) AS n FROM ai_calls").get() as unknown as { n: number };
      const cache = copy.prepare("SELECT COUNT(*) AS n FROM estimate_cache").get() as unknown as {
        n: number;
      };
      expect(calls.n).toBe(0);
      expect(cache.n).toBe(0);
      // Content survives, including the roster.
      const entries = copy.prepare("SELECT COUNT(*) AS n FROM entries").get() as unknown as {
        n: number;
      };
      const roster = copy.prepare("SELECT COUNT(*) AS n FROM people").get() as unknown as {
        n: number;
      };
      expect(entries.n).toBe(1);
      expect(roster.n).toBe(1);
    } finally {
      copy.close();
      rmSync(snapshotPath, { force: true });
    }
  });

  it("person scope carries exactly one person and the shared library", () => {
    const other = addOtherPerson();
    seedPerson(other, "2");
    // A second captured food is shared content and must travel.
    db.prepare(
      `INSERT INTO captured_foods (id, name, aliases, kind, state, source, created_by, created_at)
       VALUES ('f2', 'Upma', '[]', 'provisional', 'raw', 'manual', ?, ?)`,
    ).run(other, NOW);

    const { buffer, manifest } = archive.buildArchive({ scope: "person", personId });
    const files = readZip(buffer);

    expect(manifest.scope).toBe("person");
    expect(manifest.personId).toBe(personId);
    expect(manifest.includes.snapshot).toBe(false);
    expect(files.has("snapshot.sqlite")).toBe(false);
    expect(files.has("data/ai_calls.ndjson")).toBe(false);

    const exportedPeople = rowsOf(buffer, "people");
    expect(exportedPeople).toHaveLength(1);
    expect(exportedPeople[0].id).toBe(personId);

    expect(rowsOf(buffer, "profile").map((row) => row.id)).toEqual([personId]);
    expect(rowsOf(buffer, "plans").map((row) => row.person_id)).toEqual([personId]);
    expect(rowsOf(buffer, "entries").map((row) => row.person_id)).toEqual([personId]);
    expect(rowsOf(buffer, "food_default_amounts").map((row) => row.person_id)).toEqual([
      personId,
      personId,
    ]);
    // The whole shared library, including foods created by someone else.
    expect(rowsOf(buffer, "captured_foods").map((row) => row.id).sort()).toEqual(["f1", "f2"]);
    expect(files.get("README.txt")!.toString("utf8")).toMatch(/one person's NutriPlan data/i);
  });

  it("shared scope carries no people or personal rows", () => {
    const other = addOtherPerson();
    seedPerson(other, "2");

    const { buffer, manifest } = archive.buildArchive({ scope: "shared" });
    const files = readZip(buffer);

    expect(manifest.scope).toBe("shared");
    expect(manifest.personId).toBeNull();
    expect(files.has("snapshot.sqlite")).toBe(false);
    expect(files.has("data/ai_calls.ndjson")).toBe(false);

    for (const table of [
      "households",
      "people",
      "profile",
      "plans",
      "plan_entries",
      "entries",
      "food_default_amounts",
      "person_settings",
    ]) {
      expect(files.has(`data/${table}.ndjson`), table).toBe(false);
    }
    expect(files.has("data/captured_foods.ndjson")).toBe(true);
    expect(files.has("data/recipes.ndjson")).toBe(true);
    expect(files.get("README.txt")!.toString("utf8")).toMatch(/shared NutriPlan library/i);
  });

  it("does not attach the AI log to person or shared archives", () => {
    expect(
      readZip(archive.buildArchive({ scope: "person", personId, includeAiCalls: true }).buffer).has(
        "data/ai_calls.ndjson",
      ),
    ).toBe(false);
    expect(
      readZip(archive.buildArchive({ scope: "shared", includeAiCalls: true }).buffer).has(
        "data/ai_calls.ndjson",
      ),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Round trip                                                         */
/* ------------------------------------------------------------------ */

describe("round trip", () => {
  it("restores identical content after a full wipe", () => {
    const before = Object.fromEntries(TABLES.map((spec) => [spec.table, hashTable(spec.table)]));
    const beforeCounts = counts();

    const { buffer } = archive.buildArchive({ includeAiCalls: true });
    wipe();
    expect(counts().entries).toBe(0);
    expect(counts().recipes).toBe(0);
    expect(counts().people).toBe(0);

    const report = importer.importArchive(buffer, { mode: "replace" });

    expect(report.ok).toBe(true);
    expect(report.scope).toBe("household");
    expect(counts()).toEqual(beforeCounts);
    for (const spec of TABLES) {
      expect(hashTable(spec.table), spec.table).toBe(before[spec.table]);
    }
  });

  it("restores every person's rows after a household replace", () => {
    const other = addOtherPerson();
    seedPerson(other, "2");
    const { buffer } = archive.buildArchive();

    people.deletePerson(other);
    expect(people.countPeople()).toBe(1);

    const report = importer.importArchive(buffer, { mode: "replace" });
    expect(report.ok).toBe(true);

    expect(people.countPeople()).toBe(2);
    const roster = db
      .prepare("SELECT id, display_name FROM people ORDER BY display_name")
      .all() as unknown as Array<{ id: string; display_name: string }>;
    expect(roster).toEqual([
      { id: personId, display_name: "Me" },
      { id: other, display_name: "Priya" },
    ]);

    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(other) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?").get(other) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
  });

  it("merges a two-person household without duplicating rows", () => {
    const other = addOtherPerson();
    seedPerson(other, "2");
    const { buffer } = archive.buildArchive();

    const report = importer.importArchive(buffer, { mode: "merge" });

    expect(report.ok).toBe(true);
    expect(people.countPeople()).toBe(2);
    expect(report.tables.find((table) => table.table === "people")).toMatchObject({
      archiveRows: 2,
      added: 0,
      kept: 2,
      conflicts: 0,
    });
    for (const person of [personId, other]) {
      expect(
        (
          db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(person) as unknown as {
            n: number;
          }
        ).n,
      ).toBe(1);
      expect(
        (
          db.prepare("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?").get(person) as unknown as {
            n: number;
          }
        ).n,
      ).toBe(1);
    }
  });

  it("folds a foreign household into this installation on merge", () => {
    const foreign = toForeignHousehold(archive.buildArchive().buffer);

    const report = importer.importArchive(foreign, { mode: "merge" });

    expect(report.ok).toBe(true);
    expect(people.countPeople()).toBe(2);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM households").get() as unknown as { n: number }).n,
    ).toBe(1);

    const foreignPerson = db
      .prepare("SELECT household_id, display_name FROM people WHERE id = 'p-foreign'")
      .get() as unknown as { household_id: string; display_name: string };
    expect(foreignPerson.household_id).toBe(people.getHousehold().id);
    expect(foreignPerson.display_name).toBe("Me");

    // The foreign person's own rows arrived on their plan.
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM profile WHERE id = 'p-foreign'").get() as unknown as {
        n: number;
      }).n,
    ).toBe(1);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = 'p-foreign'").get() as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM plan_entries
              WHERE plan_id IN (SELECT id FROM plans WHERE person_id = 'p-foreign')`,
          )
          .get() as unknown as { n: number }
      ).n,
    ).toBe(1);

    // The local person's week is untouched.
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(personId) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM plan_entries WHERE plan_id = 'p-1'")
          .get() as unknown as { n: number }
      ).n,
    ).toBe(1);
  });

  it("keeps the stored recipe snapshot byte-for-byte", () => {
    const original = (
      db.prepare("SELECT snapshot FROM recipe_versions WHERE id = 'v1'").get() as unknown as {
        snapshot: string;
      }
    ).snapshot;

    const { buffer } = archive.buildArchive();
    wipe();
    importer.importArchive(buffer, { mode: "replace" });

    const restored = (
      db.prepare("SELECT snapshot FROM recipe_versions WHERE id = 'v1'").get() as unknown as {
        snapshot: string;
      }
    ).snapshot;
    expect(restored).toBe(original);
    expect(JSON.parse(restored).totals.energy_kcal).toBe(420);
  });

  it("restores evidence images", () => {
    const { buffer } = archive.buildArchive();
    wipe();
    rmSync(path.join(dir, "evidence"), { recursive: true, force: true });

    importer.importArchive(buffer, { mode: "replace" });

    const restored = path.join(dir, "evidence", "poha.png");
    expect(existsSync(restored)).toBe(true);
    expect([...readFileSync(restored)]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  });

  it("keeps provenance (source, kind, publish date) through a round trip", () => {
    const { buffer } = archive.buildArchive();
    wipe();
    importer.importArchive(buffer, { mode: "replace" });

    const row = db
      .prepare("SELECT source, source_kind, source_published FROM captured_foods WHERE id = 'f1'")
      .get() as unknown as {
      source: string;
      source_kind: string | null;
      source_published: string | null;
    };
    expect(row).toEqual({ source: "indb", source_kind: "indb", source_published: "2019" });
  });

  it("merge adds new rows and keeps existing ones", () => {
    const { buffer } = archive.buildArchive();

    const first = importer.importArchive(buffer, { mode: "merge" });
    expect(first.tables.find((table) => table.table === "entries")?.added).toBe(0);
    expect(first.tables.find((table) => table.table === "entries")?.kept).toBe(1);

    db.prepare("DELETE FROM entries WHERE id = 'e-1'").run();
    const second = importer.importArchive(buffer, { mode: "merge" });
    expect(second.tables.find((table) => table.table === "entries")?.added).toBe(1);
  });

  it("merge reports a conflict instead of overwriting", () => {
    const { buffer } = archive.buildArchive();
    db.prepare("UPDATE entries SET grams = 999 WHERE id = 'e-1'").run();

    const report = importer.importArchive(buffer, { mode: "merge" });

    expect(report.tables.find((table) => table.table === "entries")?.conflicts).toBe(1);
    const grams = (
      db.prepare("SELECT grams FROM entries WHERE id = 'e-1'").get() as unknown as { grams: number }
    ).grams;
    expect(grams).toBe(999);
    expect(report.warnings.join(" ")).toContain("Replace");
  });

  it("a dry run changes nothing", () => {
    const { buffer } = archive.buildArchive();
    const before = counts();

    const report = importer.importArchive(buffer, { mode: "replace", dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(counts()).toEqual(before);
  });

  it("handles an archive whose tables are empty", () => {
    // An empty table has no columns to infer from its rows; the importer
    // must not try to build `INSERT INTO t () VALUES ()`.
    db.exec("DELETE FROM entries");
    db.exec("DELETE FROM app_settings");
    const { buffer } = archive.buildArchive();

    wipe();
    const report = importer.importArchive(buffer, { mode: "replace" });

    expect(report.tables.find((table) => table.table === "entries")).toMatchObject({
      archiveRows: 0,
      added: 0,
      kept: 0,
    });
    expect(counts().entries).toBe(0);
    expect(counts().app_settings).toBe(0);
  });

  it("includes the AI log only when asked", () => {
    const { buffer } = archive.buildArchive({ includeAiCalls: true });
    expect(readZip(buffer).has("data/ai_calls.ndjson")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Scopes                                                             */
/* ------------------------------------------------------------------ */

describe("person scope", () => {
  it("refuses an archive carrying another person's diary", () => {
    const other = addOtherPerson();
    seedPerson(other, "2");
    const { buffer } = archive.buildArchive({ scope: "person", personId });

    const crafted = rebuild(buffer, (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/entries.ndjson", (rows) => {
        expect(rows).toHaveLength(1);
        rows[0].person_id = other;
      });
    });

    expect(() => importer.importArchive(crafted, { mode: "merge" })).toThrow(
      /another person/i,
    );
  });

  it("refuses a plan entry whose plan is not in the archive", () => {
    const { buffer } = archive.buildArchive({ scope: "person", personId });
    const crafted = rebuild(buffer, (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/plan_entries.ndjson", (rows) => {
        expect(rows).toHaveLength(1);
        rows[0].plan_id = "p-not-here";
      });
    });

    expect(() => importer.importArchive(crafted, { mode: "merge" })).toThrow(
      /plan is not in the archive/i,
    );
  });

  it("rewrites a person archive onto another person without touching the source", () => {
    const other = addOtherPerson();
    const { buffer } = archive.buildArchive({ scope: "person", personId });

    const report = importer.importArchive(buffer, {
      mode: "replace",
      targetPersonId: other,
    });

    expect(report.ok).toBe(true);
    expect(report.scope).toBe("person");
    expect(report.personId).toBe(other);

    // The source person keeps every row.
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(personId) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);

    // The target got a profile, a plan, its entries and its thresholds.
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM profile WHERE id = ?").get(other) as unknown as {
        n: number;
      }).n,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?").get(other) as unknown as {
        n: number;
      }).n,
    ).toBe(1);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(other) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM plan_entries
              WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
          )
          .get(other) as unknown as { n: number }
      ).n,
    ).toBe(1);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM person_settings WHERE person_id = ?")
          .get(other) as unknown as { n: number }
      ).n,
    ).toBe(1);

    // The plan entry was re-keyed onto the target's plan, not the source's.
    const targetPlan = (
      db.prepare("SELECT id FROM plans WHERE person_id = ?").get(other) as unknown as { id: string }
    ).id;
    const targetEntryPlan = (
      db
        .prepare(
          `SELECT pe.plan_id FROM plan_entries pe
             JOIN plans p ON p.id = pe.plan_id
            WHERE p.person_id = ?`,
        )
        .get(other) as unknown as { plan_id: string }
    ).plan_id;
    expect(targetEntryPlan).toBe(targetPlan);

    // The source plan still owns its own entries.
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM plan_entries
              WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)`,
          )
          .get(personId) as unknown as { n: number }
      ).n,
    ).toBe(1);

    // Shared rows were merged, not duplicated.
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM captured_foods").get() as unknown as { n: number }).n,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM recipes").get() as unknown as { n: number }).n,
    ).toBe(1);
  });

  it("a person replace leaves another person's rows alone", () => {
    const other = addOtherPerson();
    seedPerson(other, "2");
    const { buffer } = archive.buildArchive({ scope: "person", personId });

    // Change the source archive's owned data and restore it.
    db.prepare("UPDATE entries SET grams = 250 WHERE id = 'e-1'").run();
    importer.importArchive(buffer, { mode: "replace", targetPersonId: personId });

    expect(
      (db.prepare("SELECT grams FROM entries WHERE id = 'e-1'").get() as unknown as {
        grams: number;
      }).grams,
    ).toBe(100);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(other) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?").get(other) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM profile WHERE id = ?").get(other) as unknown as {
        n: number;
      }).n,
    ).toBe(1);
  });
});

describe("shared scope", () => {
  it("refuses a shared archive that carries people", () => {
    const { buffer } = archive.buildArchive({ scope: "person", personId });

    const crafted = rebuild(buffer, (_entries, manifest) => {
      manifest.scope = "shared";
      manifest.personId = null;
    });

    expect(() => importer.importArchive(crafted, { mode: "merge" })).toThrow(
      /shared library/i,
    );
  });

  it("replaces the shared library and leaves people and diaries alone", () => {
    const other = addOtherPerson();
    seedPerson(other, "2");
    const { buffer } = archive.buildArchive({ scope: "shared" });

    // Rows added after the export must not survive a replace.
    db.prepare(
      `INSERT INTO captured_foods (id, name, aliases, kind, state, source, created_by, created_at)
       VALUES ('f-late', 'Late food', '[]', 'provisional', 'raw', 'manual', ?, ?)`,
    ).run(personId, NOW);
    // Personal plans pin recipe versions; a shared replace must not be asked
    // to delete a parent while those references exist. The archive flow uses
    // the shared library as content, so clear the pins the way a household
    // would after changing its library, then delete the shared rows the
    // archive is meant to replace.
    db.exec("DELETE FROM plan_entries");
    db.exec("DELETE FROM component_inputs");
    db.exec("DELETE FROM components");
    db.exec("DELETE FROM recipe_versions");
    db.exec("DELETE FROM recipes");

    const report = importer.importArchive(buffer, { mode: "replace" });

    expect(report.ok).toBe(true);
    expect(report.scope).toBe("shared");
    expect(
      rowsOf(archive.buildArchive({ scope: "shared" }).buffer, "captured_foods").map((row) => row.id),
    ).not.toContain("f-late");
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM recipes").get() as unknown as { n: number }).n,
    ).toBe(1);

    // People and their diaries are untouched.
    expect(people.countPeople()).toBe(2);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(other) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM person_settings WHERE person_id = ?")
          .get(other) as unknown as { n: number }
      ).n,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM captured_foods").get() as unknown as { n: number }).n,
    ).toBe(1);
  });

  it("grafts a shared archive onto the existing library in merge mode", () => {
    const { buffer } = archive.buildArchive({ scope: "shared" });

    db.prepare(
      `INSERT INTO captured_foods (id, name, aliases, kind, state, source, created_by, created_at)
       VALUES ('f-local', 'Local upma', '[]', 'provisional', 'raw', 'manual', ?, ?)`,
    ).run(personId, NOW);

    const report = importer.importArchive(buffer, { mode: "merge" });

    expect(report.ok).toBe(true);
    expect(report.scope).toBe("shared");
    expect(
      (db.prepare("SELECT id FROM captured_foods ORDER BY id").all() as unknown as Array<{
        id: string;
      }>).map((row) => row.id),
    ).toEqual(["f-local", "f1"]);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM recipes").get() as unknown as { n: number }).n,
    ).toBe(1);
    expect(report.tables.find((table) => table.table === "captured_foods")).toMatchObject({
      added: 0,
      kept: 1,
      conflicts: 0,
    });
  });
});

/* ------------------------------------------------------------------ */
/* v1 archives                                                        */
/* ------------------------------------------------------------------ */

describe("v1 archives", () => {
  it("maps one person's rows and moves target_rules out of app_settings", () => {
    const { buffer } = archive.buildArchive({ scope: "person", personId });
    const v1 = toV1(buffer);

    db.exec("DELETE FROM plan_entries");
    db.exec("DELETE FROM plans");
    db.exec("DELETE FROM entries");
    db.exec("DELETE FROM profile");
    db.exec("DELETE FROM person_settings");
    db.exec("DELETE FROM app_settings");

    const report = importer.importArchive(v1, { mode: "merge", targetPersonId: personId });

    expect(report.ok).toBe(true);
    expect(report.formatVersion).toBe(1);
    expect(report.scope).toBe("person");
    expect(report.personId).toBe(personId);
    expect(report.warnings.join(" ")).toMatch(/Moved target rules/i);

    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM profile WHERE id = ?").get(personId) as unknown as {
        n: number;
      }).n,
    ).toBe(1);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?").get(personId) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?").get(personId) as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);

    const setting = db
      .prepare("SELECT value FROM person_settings WHERE person_id = ? AND key = 'target_rules'")
      .get(personId) as unknown as { value: string } | undefined;
    expect(setting?.value).toBe('{"amberOver":0.1}');
    expect(
      db.prepare("SELECT 1 FROM app_settings WHERE key = 'target_rules'").get(),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT 1 FROM app_settings WHERE key = 'ai_master_prompt'").get(),
    ).toBeDefined();
  });

  it("refuses replace in a multi-person household", () => {
    addOtherPerson();
    const { buffer } = archive.buildArchive({ scope: "person", personId });
    const v1 = toV1(buffer);

    expect(() =>
      importer.importArchive(v1, { mode: "replace", targetPersonId: personId }),
    ).toThrow(/predates household support/i);
  });

  it("refuses a v2 archive that claims a person but names no one", () => {
    const { buffer } = archive.buildArchive({ scope: "person", personId });
    const crafted = rebuild(buffer, (_entries, manifest) => {
      delete manifest.personId;
    });

    expect(() => importer.parseArchive(crafted)).toThrow(/does not name the person/i);
  });
});

/* ------------------------------------------------------------------ */
/* Hostile archives                                                   */
/* ------------------------------------------------------------------ */

describe("hostile archives", () => {
  it("keeps the built-in retention factors through a replace", () => {
    const seedCount = () =>
      (
        db.prepare("SELECT COUNT(*) AS n FROM retention_factors WHERE origin = 'seed'").get() as unknown as {
          n: number;
        }
      ).n;

    const before = seedCount();
    expect(before).toBeGreaterThan(0);

    const { buffer } = archive.buildArchive();
    importer.importArchive(buffer, { mode: "replace" });

    expect(seedCount()).toBe(before);
  });

  it("cannot let an archive mark a row as a built-in factor", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/retention_factors.ndjson", (rows) => {
        expect(rows).toHaveLength(1);
        rows[0].origin = "seed";
      });
    });

    const report = importer.importArchive(crafted, { mode: "replace" });

    expect(report.ok).toBe(true);
    const origin = (
      db.prepare("SELECT origin FROM retention_factors WHERE id = 'rf1'").get() as unknown as {
        origin: string;
      }
    ).origin;
    expect(origin).toBe("user");

    // And it is still visible to the next export.
    const next = readZip(archive.buildArchive().buffer)
      .get("data/retention_factors.ndjson")!
      .toString("utf8");
    expect(next).toContain("rf1");
  });

  it("refuses settings this build cannot restore", () => {
    const { buffer } = archive.buildArchive();
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('future_setting', 'keep me')").run();

    const crafted = rebuild(buffer, (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/app_settings.ndjson", (rows) => {
        rows.push({ key: "planted_setting", value: "from the archive" });
      });
      (manifest.counts as Record<string, number>).app_settings = 2;
    });

    const report = importer.importArchive(crafted, { mode: "replace" });

    const keys = (db.prepare("SELECT key FROM app_settings ORDER BY key").all() as unknown as Array<{
      key: string;
    }>).map((row) => row.key);
    expect(keys).toContain("ai_master_prompt");
    // Replace deletes only keys it could restore.
    expect(keys).toContain("future_setting");
    expect(keys).not.toContain("planted_setting");
    expect(report.warnings.join(" ")).toContain("Dropped 1 setting(s)");
  });

  it("downgrades an unsafe evidence path instead of storing it", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/captured_foods.ndjson", (rows) => {
        expect(rows).toHaveLength(1);
        rows[0].image_path = "data/evidence/../../secrets.json";
      });
    });

    const report = importer.importArchive(crafted, { mode: "replace" });

    const imagePath = (
      db.prepare("SELECT image_path FROM captured_foods WHERE id = 'f1'").get() as unknown as {
        image_path: string | null;
      }
    ).image_path;
    expect(imagePath).toBeNull();
    expect(report.warnings.join(" ")).toMatch(/unsafe evidence path/);
  });

  it("repoints evidence only for captured foods this import inserted", () => {
    // A second shared food points at the same image, so the archive carries
    // one evidence file with two references.
    db.prepare(
      `INSERT INTO captured_foods
         (id, name, aliases, kind, state, source, image_path, created_by, created_at)
       VALUES ('f2', 'Poha (leftovers)', '[]', 'provisional', 'raw', 'manual',
               'data/evidence/poha.png', ?, ?)`,
    ).run(personId, NOW);

    const { buffer } = archive.buildArchive({ scope: "person", personId });

    // f2 will be inserted by the import; f1 already exists and must keep its
    // own image. Change the existing file so the archive's image needs a new
    // name instead of silently overwriting bytes another row points at.
    db.prepare("DELETE FROM captured_foods WHERE id = 'f2'").run();
    const conflictBytes = Buffer.from([9, 9, 9]);
    writeFileSync(path.join(dir, "evidence", "poha.png"), conflictBytes);

    const report = importer.importArchive(buffer, {
      mode: "replace",
      targetPersonId: personId,
    });
    expect(report.ok).toBe(true);

    const rows = db
      .prepare("SELECT id, image_path FROM captured_foods ORDER BY id")
      .all() as unknown as Array<{ id: string; image_path: string }>;
    expect(rows[0]).toEqual({ id: "f1", image_path: "data/evidence/poha.png" });
    expect(rows[1].id).toBe("f2");
    expect(rows[1].image_path).toMatch(/^data\/evidence\/poha-[0-9a-f]{8}\.png$/);

    // The existing file was not overwritten, and the inserted row points at
    // the archive's bytes under the new name.
    expect([...readFileSync(path.join(dir, "evidence", "poha.png"))]).toEqual([
      ...conflictBytes,
    ]);
    const restored = path.join(dir, "evidence", path.basename(rows[1].image_path));
    expect([...readFileSync(restored)]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  });

  it("reports a unique collision in merge instead of dropping the row", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/recipe_versions.ndjson", (rows) => {
        expect(rows).toHaveLength(1);
        // Same recipe and version number, different primary key: the insert
        // reaches the `(recipe_id, version_no)` UNIQUE constraint.
        rows[0].id = "v-copy";
      });
    });

    const report = importer.importArchive(crafted, { mode: "merge" });

    const versions = report.tables.find((table) => table.table === "recipe_versions")!;
    expect(versions.added).toBe(0);
    expect(versions.conflicts).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM recipe_versions").get() as unknown as { n: number }).n,
    ).toBe(1);
  });

  it("rejects a manifest that lists one path twice", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      const files = manifest.files as Array<{ path: string; sha256: string; bytes: number }>;
      files.push({ ...files[0] });
    });
    expect(() => importer.parseArchive(crafted)).toThrow(/twice/);
  });

  it("rejects a local header that disagrees with the central directory", () => {
    const { buffer } = archive.buildArchive();
    const local = Buffer.from(buffer);
    const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    let offset = 0;
    let nameStart = -1;

    while ((offset = local.indexOf(signature, offset)) !== -1) {
      const nameLength = local.readUInt16LE(offset + 26);
      const name = local.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
      if (name === "data/entries.ndjson") {
        nameStart = offset + 30;
        break;
      }
      offset += 4;
    }

    expect(nameStart).toBeGreaterThan(-1);
    local[nameStart] = "x".charCodeAt(0);
    expect(() => readZip(local)).toThrow(/mismatched local name/);
  });

  it("rejects a tampered file", () => {
    const { buffer } = archive.buildArchive();
    const files = readZip(buffer);
    const entries = [...files.entries()].map(([name, data]) => ({ name, data }));
    const target = entries.find((entry) => entry.name === "data/entries.ndjson")!;
    target.data = Buffer.from(target.data.toString("utf8").replace("paneer", "cheese"));
    // The manifest still lists the old checksum.
    expect(() => importer.parseArchive(writeZip(entries))).toThrow(/Checksum mismatch/);
  });

  it("rejects an unknown table", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      const data = Buffer.from('{"id":"x"}\n', "utf8");
      entries.push({ name: "data/evil.ndjson", data });
      (manifest.files as Array<{ path: string; sha256: string; bytes: number }>).push({
        path: "data/evil.ndjson",
        sha256: createHash("sha256").update(data).digest("hex"),
        bytes: data.length,
      });
      (manifest.columns as Record<string, string[]>).evil = ["id"];
      (manifest.counts as Record<string, number>).evil = 1;
    });
    expect(() => importer.parseArchive(crafted)).toThrow(/unknown table/i);
  });

  it("rejects an unlisted file", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries) => {
      entries.push({ name: "files/evidence/extra.png", data: Buffer.from("x") });
    });
    expect(() => importer.parseArchive(crafted)).toThrow(/unlisted file/);
  });

  it("rejects a row missing a required column", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      const target = entries.find((entry) => entry.name === "data/entries.ndjson")!;
      const row = JSON.parse(target.data.toString("utf8").trim()) as Record<string, unknown>;
      delete row.day;
      target.data = Buffer.from(JSON.stringify(row) + "\n", "utf8");
      const listed = (manifest.files as Array<{ path: string; sha256: string; bytes: number }>).find(
        (file) => file.path === "data/entries.ndjson",
      )!;
      listed.sha256 = createHash("sha256").update(target.data).digest("hex");
      listed.bytes = target.data.length;
    });
    expect(() => importer.importArchive(crafted, { mode: "replace" })).toThrow(/required field "day"/);
  });

  it("rejects a row whose parent is missing", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      const index = entries.findIndex((entry) => entry.name === "data/recipes.ndjson");
      entries.splice(index, 1);
      manifest.files = (manifest.files as Array<{ path: string }>).filter(
        (file) => file.path !== "data/recipes.ndjson",
      );
    });
    // Start from an empty database: otherwise the seeded `recipes` row is
    // still present and the dangling child would not be dangling.
    wipe();
    expect(() => importer.importArchive(crafted, { mode: "replace" })).toThrow(/inconsistent/);
  });

  it("rejects a household plan entry naming a plan outside the archive", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/plan_entries.ndjson", (rows) => {
        expect(rows).toHaveLength(1);
        rows[0].plan_id = "p-not-in-this-archive";
      });
    });

    expect(() => importer.importArchive(crafted, { mode: "merge" })).toThrow(
      /plan is not in the archive/i,
    );
  });

  it("never attaches a merged plan entry to another person's plan", () => {
    // Take a foreign household but give its plan the id of the local
    // person's plan. A naive merge would skip the plan as a conflict and
    // then insert the foreign entry into the local week.
    const foreign = rebuild(toForeignHousehold(archive.buildArchive().buffer), (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/plans.ndjson", (rows) => {
        rows[0].id = "p-1";
      });
      rewriteEntry(entries, manifest, "data/plan_entries.ndjson", (rows) => {
        rows[0].plan_id = "p-1";
      });
    });

    const report = importer.importArchive(foreign, { mode: "merge" });
    expect(report.ok).toBe(true);

    const localPlan = db
      .prepare("SELECT id, person_id FROM plans WHERE id = 'p-1'")
      .get() as unknown as { id: string; person_id: string };
    expect(localPlan.person_id).toBe(personId);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM plan_entries WHERE plan_id = 'p-1'").get() as unknown as {
          n: number;
        }
      ).n,
    ).toBe(1);

    const foreignPlan = db
      .prepare("SELECT id, starts_on FROM plans WHERE person_id = 'p-foreign'")
      .get() as unknown as { id: string; starts_on: string };
    expect(foreignPlan.id).not.toBe("p-1");
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM plan_entries WHERE plan_id = ?")
          .get(foreignPlan.id) as unknown as { n: number }
      ).n,
    ).toBe(1);
  });

  it("rejects a traversal name", () => {
    expect(() => assertSafeEntryName("../evil.txt")).toThrow();
    expect(() => assertSafeEntryName("/etc/passwd")).toThrow();
    expect(() => assertSafeEntryName("a/../../b")).toThrow();
    expect(() => assertSafeEntryName("C:\\x")).toThrow();
    expect(() => assertSafeEntryName("data/../x.ndjson")).toThrow();
    expect(() => assertSafeEntryName("data/ok.ndjson")).not.toThrow();
  });

  it("rejects an archive over the entry limit", () => {
    const { buffer } = archive.buildArchive();
    expect(() =>
      readZip(buffer, { maxEntries: 2, maxEntryBytes: 1e9, maxTotalBytes: 1e9, maxRatio: 1e9, ratioFloorBytes: 1 }),
    ).toThrow(/more than 2 entries/);
  });

  it("rejects a zip bomb", () => {
    const bomb = writeZip([{ name: "a.txt", data: Buffer.alloc(2 * 1024 * 1024, 0) }]);
    expect(() =>
      readZip(bomb, {
        maxEntries: 100,
        maxEntryBytes: 64 * 1024 * 1024,
        maxTotalBytes: 64 * 1024 * 1024,
        maxRatio: 10,
        ratioFloorBytes: 1024,
      }),
    ).toThrow(/zip bomb/);
  });

  it("rejects a non-ZIP file", () => {
    expect(() => importer.parseArchive(Buffer.from("not a zip"))).toThrow(/not a ZIP/);
  });
});

/* ------------------------------------------------------------------ */
/* Archive fidelity                                                   */
/* ------------------------------------------------------------------ */

describe("archive fidelity", () => {
  function updateChecksum(
    manifest: Record<string, unknown>,
    name: string,
    data: Buffer,
  ): void {
    const listed = (
      manifest.files as Array<{ path: string; sha256: string; bytes: number }>
    ).find((file) => file.path === name)!;
    listed.sha256 = createHash("sha256").update(data).digest("hex");
    listed.bytes = data.length;
  }

  function encode(rows: Array<Record<string, unknown>>): Buffer {
    return Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  }

  it("rejects a row count the manifest does not match", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (_entries, manifest) => {
      (manifest.counts as Record<string, number>).entries = 2;
    });
    expect(() => importer.parseArchive(crafted)).toThrow(/manifest says "entries" has 2/);
  });

  it("rejects a duplicated column in the manifest", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (_entries, manifest) => {
      (manifest.columns as Record<string, string[]>).entries = ["id", "id"];
    });
    expect(() => importer.parseArchive(crafted)).toThrow(/column twice/);
  });

  it("applies a column default when an older archive omits the column", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      const target = entries.find((entry) => entry.name === "data/profile.ndjson")!;
      const rows = target.data
        .toString("utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      for (const row of rows) delete row.pace;
      target.data = encode(rows);
      updateChecksum(manifest, target.name, target.data);
      (manifest.columns as Record<string, string[]>).profile = (
        manifest.columns as Record<string, string[]>
      ).profile.filter((column) => column !== "pace");
    });

    importer.importArchive(crafted, { mode: "replace" });

    const pace = (
      db.prepare("SELECT pace FROM profile WHERE id = ?").get(personId) as unknown as {
        pace: string;
      }
    ).pace;
    expect(pace).toBe("steady");
  });

  it("applies a default per row when only some rows omit a column", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      const target = entries.find((entry) => entry.name === "data/captured_foods.ndjson")!;
      const rows = target.data
        .toString("utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const [first] = rows;
      const second: Record<string, unknown> = {
        ...first,
        id: "f2",
        name: "Upma",
        aliases: "[]",
        image_path: null,
      };
      delete second.created_by;
      // The first row still carries the column, so a table-wide union would
      // write `null` for the second row instead of the default.
      first.created_by = personId;
      target.data = encode([first, second]);
      updateChecksum(manifest, target.name, target.data);
      (manifest.counts as Record<string, number>).captured_foods = 2;
    });

    const report = importer.importArchive(crafted, { mode: "replace" });
    expect(report.tables.find((table) => table.table === "captured_foods")?.added).toBe(2);

    const rows = db
      .prepare("SELECT id, created_by FROM captured_foods ORDER BY id")
      .all() as unknown as Array<{ id: string; created_by: string }>;
    expect(rows).toEqual([
      { id: "f1", created_by: personId },
      { id: "f2", created_by: "local" },
    ]);
  });
});
