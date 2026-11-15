import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Data integrity.
 *
 * The database is the only durable thing in the product. These tests pin the
 * rules the UI relies on but cannot enforce: that a plan entry is a food XOR a
 * recipe version, that history cannot be orphaned, that a half-finished recipe
 * save never lands, and that the connection is configured the way the
 * concurrency notes in DATA-MODEL.md claim.
 */
let dir: string;
let dbPath: string;
let db: typeof import("@/lib/db/client")["db"];
let transaction: typeof import("@/lib/db/client")["transaction"];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-integrity-"));
  dbPath = path.join(dir, "test.sqlite");
  vi.stubEnv("NUTRIPLAN_DB_PATH", dbPath);
  const client = await import("@/lib/db/client");
  db = client.db;
  transaction = client.transaction;
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function pragma(name: string) {
  return db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
}

function columns(table: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>).map(
    (entry) => entry.name,
  );
}

function insertRecipe(id: string) {
  db.prepare(
    `INSERT INTO recipes (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(id, "Test recipe", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
}

function insertVersion(id: string, recipeId: string, versionNo = 1) {
  db.prepare(
    `INSERT INTO recipe_versions
       (id, recipe_id, version_no, instructions, servings, snapshot, calculation_version, created_at)
     VALUES (?, ?, ?, '', 2, '{}', 'test', ?)`,
  ).run(id, recipeId, versionNo, "2026-01-01T00:00:00.000Z");
}

let planSeq = 0;

function insertPlan(id: string) {
  planSeq += 1;
  db.prepare(`INSERT INTO plans (id, starts_on, created_at) VALUES (?, ?, ?)`).run(
    id,
    `2030-01-${String(planSeq).padStart(2, "0")}`,
    "2026-01-01T00:00:00.000Z",
  );
}

function insertPlanEntry(overrides: {
  id: string;
  planId: string;
  foodId?: string | null;
  recipeVersionId?: string | null;
}) {
  db.prepare(
    `INSERT INTO plan_entries
       (id, plan_id, day, slot, position, food_id, recipe_version_id, grams, amount, unit, servings, created_at)
     VALUES (?, ?, '2026-01-01', 'breakfast', 0, ?, ?, 100, 1, 'g', NULL, ?)`,
  ).run(
    overrides.id,
    overrides.planId,
    overrides.foodId ?? null,
    overrides.recipeVersionId ?? null,
    "2026-01-01T00:00:00.000Z",
  );
}

describe("connection configuration", () => {
  it("enforces foreign keys", () => {
    expect(pragma("foreign_keys").foreign_keys).toBe(1);
  });

  it("waits for a lock instead of failing immediately", () => {
    expect(pragma("busy_timeout").timeout).toBe(5000);
  });

  it("uses write-ahead logging so a reader does not block a writer", () => {
    expect(String(pragma("journal_mode").journal_mode).toLowerCase()).toBe("wal");
  });
});

describe("migrations", () => {
  it("has every column the current code reads", () => {
    expect(columns("profile")).toEqual(
      expect.arrayContaining(["body_fat_percent", "pace", "target_weight_kg"]),
    );
    expect(columns("recipe_versions")).toContain("label");
  });

  it("is safe to run again on an existing file", async () => {
    const before = columns("profile");

    // Force a fresh module instance so `createDb()` runs a second time
    // against the same file, which is what happens on every boot.
    vi.resetModules();
    delete (globalThis as { __nutriplanDb?: unknown }).__nutriplanDb;
    const fresh = await import("@/lib/db/client");

    expect(
      (fresh.db.prepare("PRAGMA table_info(profile)").all() as unknown as Array<{ name: string }>).map(
        (entry) => entry.name,
      ),
    ).toEqual(before);
  });
});

function insertDiaryEntry(overrides: {
  id: string;
  foodId?: string | null;
  recipeVersionId?: string | null;
}) {
  db.prepare(
    `INSERT INTO entries (id, food_id, recipe_version_id, grams, amount, unit, day, created_at)
     VALUES (?, ?, ?, 100, 1, 'g', '2026-01-01', ?)`,
  ).run(
    overrides.id,
    overrides.foodId ?? null,
    overrides.recipeVersionId ?? null,
    "2026-01-01T00:00:00.000Z",
  );
}

describe("diary entry cardinality", () => {
  it("rejects an entry that is both a food and a recipe", () => {
    insertRecipe("r-diary-both");
    insertVersion("v-diary-both", "r-diary-both");

    expect(() =>
      insertDiaryEntry({ id: "e-diary-both", foodId: "paneer", recipeVersionId: "v-diary-both" }),
    ).toThrow(/CHECK/i);
  });

  it("rejects an entry that is neither a food nor a recipe", () => {
    expect(() =>
      insertDiaryEntry({ id: "e-diary-neither", foodId: null, recipeVersionId: null }),
    ).toThrow(/CHECK/i);
  });

  it("accepts exactly one of the two", () => {
    expect(() => insertDiaryEntry({ id: "e-diary-food", foodId: "paneer" })).not.toThrow();
  });
});

describe("plan entry cardinality", () => {
  it("rejects an entry that is both a food and a recipe", () => {
    insertRecipe("r-both");
    insertVersion("v-both", "r-both");
    insertPlan("p-both");

    expect(() =>
      insertPlanEntry({ id: "e-both", planId: "p-both", foodId: "paneer", recipeVersionId: "v-both" }),
    ).toThrow(/CHECK/i);
  });

  it("rejects an entry that is neither a food nor a recipe", () => {
    insertPlan("p-neither");

    expect(() =>
      insertPlanEntry({ id: "e-neither", planId: "p-neither", foodId: null, recipeVersionId: null }),
    ).toThrow(/CHECK/i);
  });

  it("accepts exactly one of the two", () => {
    insertPlan("p-one");
    expect(() =>
      insertPlanEntry({ id: "e-food", planId: "p-one", foodId: "paneer" }),
    ).not.toThrow();
  });
});

describe("referential integrity", () => {
  it("refuses a diary entry pointing at a missing recipe version", () => {
    expect(() =>
      insertDiaryEntry({ id: "e-diary-ghost", recipeVersionId: "missing-version" }),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("refuses a plan entry pointing at a missing recipe version", () => {
    insertPlan("p-ghost");

    expect(() =>
      insertPlanEntry({ id: "e-ghost", planId: "p-ghost", recipeVersionId: "missing-version" }),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("refuses to orphan recipe history that a plan still uses", () => {
    insertRecipe("r-pinned");
    insertVersion("v-pinned", "r-pinned");
    insertPlan("p-pinned");
    insertPlanEntry({ id: "e-pinned", planId: "p-pinned", recipeVersionId: "v-pinned" });

    expect(() => db.prepare(`DELETE FROM recipe_versions WHERE id = ?`).run("v-pinned")).toThrow(
      /FOREIGN KEY/i,
    );
  });

  it("refuses a component input with no component", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO component_inputs
             (id, component_id, position, food_id, grams, amount, unit)
           VALUES ('i-orphan', 'missing-component', 0, 'paneer', 100, 1, 'g')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe("version identity", () => {
  it("does not allow two versions with the same number", () => {
    insertRecipe("r-dup");
    insertVersion("v-dup-1", "r-dup", 1);

    expect(() => insertVersion("v-dup-2", "r-dup", 1)).toThrow(/UNIQUE/i);
  });
});

describe("transactions", () => {
  it("rolls back every statement when one fails", () => {
    const count = () =>
      (db.prepare(`SELECT COUNT(*) AS n FROM entries`).get() as { n: number }).n;
    const before = count();

    expect(() =>
      transaction(() => {
        db.prepare(
          `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
           VALUES ('tx-1', 'paneer', 100, 1, 'g', '2026-01-01', '2026-01-01T00:00:00.000Z')`,
        ).run();
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(count()).toBe(before);
  });

  it("commits when the callback succeeds", () => {
    transaction(() => {
      db.prepare(
        `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
         VALUES ('tx-2', 'paneer', 100, 1, 'g', '2026-01-02', '2026-01-02T00:00:00.000Z')`,
      ).run();
    });

    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE id = 'tx-2'`).get() as { n: number }).n,
    ).toBe(1);
  });
});
