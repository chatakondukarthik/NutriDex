import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Total export / total import.
 *
 * The acceptance test is the one the security tracker names: export, wipe,
 * import, compare. It runs against a throwaway database with a row in every
 * exported table, and compares a content hash per table rather than just
 * counts — a count match with different values is the failure this is meant
 * to catch.
 */

let dir: string;
let archive: typeof import("@/lib/archive/export");
let importer: typeof import("@/lib/archive/import");
let dbModule: typeof import("@/lib/db/client");
let db: typeof import("@/lib/db/client")["db"];
let TABLES: typeof import("@/lib/archive/registry")["TABLES"];
let writeZip: typeof import("@/lib/archive/zip")["writeZip"];
let readZip: typeof import("@/lib/archive/zip")["readZip"];
let assertSafeEntryName: typeof import("@/lib/archive/zip")["assertSafeEntryName"];
let manifestPath: string;

const PK: Record<string, string[]> = {
  profile: ["id"],
  recipes: ["id"],
  recipe_versions: ["id"],
  components: ["id"],
  component_inputs: ["id"],
  plans: ["id"],
  plan_entries: ["id"],
  entries: ["id"],
  captured_foods: ["id"],
  captured_food_nutrients: ["food_id", "nutrient"],
  captured_food_portions: ["id"],
  food_default_amounts: ["food_id"],
  retention_factors: ["id"],
  app_settings: ["key"],
  ai_calls: ["id"],
};

const WHERE: Record<string, string> = {
  retention_factors: "origin = 'user'",
};

function hashTable(table: string): string {
  const where = WHERE[table] ? ` WHERE ${WHERE[table]}` : "";
  const rows = db.prepare(`SELECT * FROM ${table}${where} ORDER BY rowid`).all();
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

function wipe(): void {
  for (const spec of [...TABLES].reverse()) {
    db.exec(spec.where ? `DELETE FROM ${spec.table} WHERE ${spec.where}` : `DELETE FROM ${spec.table}`);
  }
}

function seed(): void {
  const now = "2026-11-17T10:00:00.000Z";
  db.prepare(
    `INSERT INTO profile (id, sex, age_years, height_cm, weight_kg, activity, goal, pace, updated_at)
     VALUES ('local', 'male', 30, 175, 70, 'moderate', 'maintain', 'steady', ?)`,
  ).run(now);

  db.prepare(
    `INSERT INTO recipes (id, kind, name, current_version_id, created_at, updated_at)
     VALUES ('r1', 'dish', 'Dal', 'v1', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO recipe_versions (id, recipe_id, version_no, instructions, servings, yield_g,
       snapshot, calculation_version, label, created_at)
     VALUES ('v1', 'r1', 1, 'Boil, then temper.', 2, 500, ?, '2', 'trial', ?)`,
  ).run(JSON.stringify({ v: 2, totals: { energy_kcal: 420 } }), now);
  db.prepare(
    `INSERT INTO components (id, recipe_version_id, position, name, operation, output_g)
     VALUES ('c1', 'v1', 0, 'Base', 'boil', 500)`,
  ).run();
  db.prepare(
    `INSERT INTO component_inputs (id, component_id, position, food_id, grams, amount, unit, preparation, note)
     VALUES ('i1', 'c1', 0, 'paneer', 100, 100, 'g', 'diced', 'from the corner shop')`,
  ).run();

  db.prepare(`INSERT INTO plans (id, starts_on, created_at) VALUES ('p1', '2026-11-16', ?)`).run(now);
  db.prepare(
    `INSERT INTO plan_entries (id, plan_id, day, slot, position, recipe_version_id, servings, created_at)
     VALUES ('pe1', 'p1', '2026-11-16', 'lunch', 0, 'v1', 1, ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
     VALUES ('e1', 'paneer', 100, 100, 'g', '2026-11-16', ?)`,
  ).run(now);

  db.prepare(
    `INSERT INTO captured_foods (id, name, aliases, kind, state, source, image_path, created_at)
     VALUES ('f1', 'Poha', '["pohaa"]', 'provisional', 'raw', 'manual', 'data/evidence/poha.png', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO captured_food_nutrients (food_id, nutrient, amount, status)
     VALUES ('f1', 'energy_kcal', 130, 'measured')`,
  ).run();
  db.prepare(
    `INSERT INTO captured_food_portions (id, food_id, label, grams, source)
     VALUES ('pp1', 'f1', 'katori', 150, 'label')`,
  ).run();
  db.prepare(
    `INSERT INTO food_default_amounts (food_id, amount, unit, updated_at)
     VALUES ('f1', 1, 'katori', ?)`,
  ).run(now);

  db.prepare(
    `INSERT INTO retention_factors (id, operation, qualifier, nutrient, factor, source, notes, origin)
     VALUES ('rf1', 'pressure-cook', NULL, 'vitamin_c', 0.6, 'user', 'own measurement', 'user')`,
  ).run();

  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('ai_master_prompt', 'South Indian home food.')`).run();

  db.prepare(
    `INSERT INTO ai_calls (id, provider, model, capability, status, created_at)
     VALUES ('a1', 'openai', 'gpt-x', 'estimate', 'ok', ?)`,
  ).run(now);
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
  seed();
});

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

    expect(manifest.counts.entries).toBe(1);
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
      `INSERT INTO captured_foods (id, name, aliases, kind, state, source, image_path, created_at)
       VALUES ('f2', 'Poha (leftovers)', '[]', 'provisional', 'raw', 'manual', 'data/evidence/poha.png', '2026-11-17T10:00:00.000Z')`,
    ).run();

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
      // Content survives.
      const entries = copy.prepare("SELECT COUNT(*) AS n FROM entries").get() as unknown as {
        n: number;
      };
      expect(entries.n).toBe(1);
    } finally {
      copy.close();
      rmSync(snapshotPath, { force: true });
    }
  });
});

describe("round trip", () => {
  it("restores identical content after a full wipe", () => {
    const before = Object.fromEntries(TABLES.map((spec) => [spec.table, hashTable(spec.table)]));
    const beforeCounts = counts();

    const { buffer } = archive.buildArchive({ includeAiCalls: true });
    wipe();
    expect(counts().entries).toBe(0);
    expect(counts().recipes).toBe(0);

    const report = importer.importArchive(buffer, { mode: "replace" });

    expect(report.ok).toBe(true);
    expect(counts()).toEqual(beforeCounts);
    for (const spec of TABLES) {
      expect(hashTable(spec.table), spec.table).toBe(before[spec.table]);
    }
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

  it("merge adds new rows and keeps existing ones", () => {
    const { buffer } = archive.buildArchive();

    const first = importer.importArchive(buffer, { mode: "merge" });
    expect(first.tables.find((table) => table.table === "entries")?.added).toBe(0);
    expect(first.tables.find((table) => table.table === "entries")?.kept).toBe(1);

    db.prepare("DELETE FROM entries WHERE id = 'e1'").run();
    const second = importer.importArchive(buffer, { mode: "merge" });
    expect(second.tables.find((table) => table.table === "entries")?.added).toBe(1);
  });

  it("merge reports a conflict instead of overwriting", () => {
    const { buffer } = archive.buildArchive();
    db.prepare("UPDATE entries SET grams = 999 WHERE id = 'e1'").run();

    const report = importer.importArchive(buffer, { mode: "merge" });

    expect(report.tables.find((table) => table.table === "entries")?.conflicts).toBe(1);
    const grams = (
      db.prepare("SELECT grams FROM entries WHERE id = 'e1'").get() as unknown as { grams: number }
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

describe("hostile archives", () => {
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
    const withManifest = [
      { name: manifestPath, data: Buffer.from(JSON.stringify(manifest), "utf8") },
      ...entries,
    ];
    return writeZip(withManifest);
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

  it("reports a unique collision in merge instead of dropping the row", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      rewriteEntry(entries, manifest, "data/plans.ndjson", (rows) => {
        expect(rows).toHaveLength(1);
        // Same week, different id: the primary key does not match, so the
        // insert reaches the `starts_on` UNIQUE constraint.
        rows[0].id = "p2";
      });
    });

    const report = importer.importArchive(crafted, { mode: "merge" });

    const plans = report.tables.find((table) => table.table === "plans")!;
    expect(plans.added).toBe(0);
    expect(plans.conflicts).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM plans").get() as unknown as { n: number }).n,
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

describe("archive fidelity", () => {
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

  function rowsOf(data: Buffer): Array<Record<string, unknown>> {
    return data
      .toString("utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
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
      const rows = rowsOf(target.data).map((row) => {
        delete row.pace;
        return row;
      });
      target.data = encode(rows);
      updateChecksum(manifest, target.name, target.data);
      (manifest.columns as Record<string, string[]>).profile = (
        manifest.columns as Record<string, string[]>
      ).profile.filter((column) => column !== "pace");
    });

    importer.importArchive(crafted, { mode: "replace" });

    const pace = (
      db.prepare("SELECT pace FROM profile WHERE id = 'local'").get() as unknown as {
        pace: string;
      }
    ).pace;
    expect(pace).toBe("steady");
  });

  it("applies a default per row when only some rows omit a column", () => {
    const { buffer } = archive.buildArchive();
    const crafted = rebuild(buffer, (entries, manifest) => {
      const target = entries.find((entry) => entry.name === "data/captured_foods.ndjson")!;
      const [first] = rowsOf(target.data);
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
      first.created_by = "local";
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
      { id: "f1", created_by: "local" },
      { id: "f2", created_by: "local" },
    ]);
  });
});
