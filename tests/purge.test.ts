import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Deleting user data by category.
 *
 * The promises under test:
 *
 *   1. a category deletes exactly the rows it names, and nothing else;
 *   2. a parent is refused while a category the user did not select still
 *      references it — the transaction rolls back rather than leaving a
 *      dangling row or silently cascading;
 *   3. evidence files follow their rows, but a hand-edited path cannot
 *      escape `data/evidence`;
 *   4. seed foods, seed retention factors, `meta` and non-importable
 *      settings survive every selection.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let dir: string;
let purge: typeof import("@/lib/db/purge");
let actions: typeof import("@/app/actions");
let db: typeof import("@/lib/db/client")["db"];

const NOW = "2026-11-18T10:00:00.000Z";
const EVIDENCE = "poha.png";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-purge-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);

  purge = await import("@/lib/db/purge");
  actions = await import("@/app/actions");
  db = (await import("@/lib/db/client")).db;

  mkdirSync(path.join(dir, "evidence"), { recursive: true });
  writeFileSync(path.join(dir, "evidence", EVIDENCE), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function wipe(): void {
  // Children before parents, mirroring the foreign keys.
  db.exec(`
    DELETE FROM estimate_cache;
    DELETE FROM ai_calls;
    DELETE FROM component_inputs;
    DELETE FROM components;
    DELETE FROM plan_entries;
    DELETE FROM entries;
    DELETE FROM recipe_versions;
    DELETE FROM recipes;
    DELETE FROM plans;
    DELETE FROM captured_food_nutrients;
    DELETE FROM captured_food_portions;
    DELETE FROM food_default_amounts;
    DELETE FROM captured_foods;
    DELETE FROM profile;
    DELETE FROM app_settings;
    DELETE FROM retention_factors WHERE origin = 'user';
  `);
}

function seed(): void {
  db.prepare(
    `INSERT INTO profile (id, sex, age_years, height_cm, weight_kg, activity, goal, pace, updated_at)
     VALUES ('local', 'male', 30, 175, 70, 'moderate', 'maintain', 'steady', ?)`,
  ).run(NOW);

  db.prepare(
    `INSERT INTO recipes (id, kind, name, current_version_id, created_at, updated_at)
     VALUES ('r1', 'dish', 'Dal', 'v1', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO recipe_versions (id, recipe_id, version_no, instructions, servings, yield_g,
       snapshot, calculation_version, label, created_at)
     VALUES ('v1', 'r1', 1, 'Boil.', 2, 500, '{}', '2', NULL, ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO components (id, recipe_version_id, position, name, operation, output_g)
     VALUES ('c1', 'v1', 0, 'Base', 'boil', 500)`,
  ).run();
  db.prepare(
    `INSERT INTO component_inputs (id, component_id, position, food_id, grams, amount, unit)
     VALUES ('i1', 'c1', 0, 'paneer', 100, 100, 'g')`,
  ).run();

  db.prepare(`INSERT INTO plans (id, starts_on, created_at) VALUES ('p1', '2026-11-16', ?)`).run(NOW);
  db.prepare(
    `INSERT INTO plan_entries (id, plan_id, day, slot, position, food_id, grams, amount, unit, created_at)
     VALUES ('pe1', 'p1', '2026-11-16', 'lunch', 0, 'paneer', 100, 100, 'g', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
     VALUES ('e1', 'paneer', 100, 100, 'g', '2026-11-16', ?)`,
  ).run(NOW);

  db.prepare(
    `INSERT INTO captured_foods (id, name, aliases, kind, state, source, image_path, created_at)
     VALUES ('f1', 'Poha', '[]', 'provisional', 'raw', 'manual', ?, ?)`,
  ).run(`data/evidence/${EVIDENCE}`, NOW);
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
  ).run(NOW);
  // A pin for a seed food must survive deleting captured foods.
  db.prepare(
    `INSERT INTO food_default_amounts (food_id, amount, unit, updated_at)
     VALUES ('paneer', 100, 'g', ?)`,
  ).run(NOW);

  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('ai_master_prompt', 'Home food.')`).run();
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('target_rules', '{}')`).run();
  // Not on the archive allowlist: a purge must not become a back door that
  // wipes a setting the app cannot restore.
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('internal_future', 'keep me')`).run();

  db.prepare(
    `INSERT INTO ai_calls (id, provider, model, capability, status, created_at)
     VALUES ('a1', 'gemini', 'flash', 'estimate', 'ok', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO estimate_cache (cache_key, operation, payload, created_at)
     VALUES ('k1', 'boil', '{}', ?)`,
  ).run(NOW);

  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('created_at', ?)`).run(NOW);
}

function count(sql: string): number {
  return (db.prepare(sql).get() as unknown as { n: number }).n;
}

function foodReferencedByDiary(): void {
  db.prepare(
    `INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
     VALUES ('e2', 'f1', 150, 1, 'portion:katori', '2026-11-17', ?)`,
  ).run(NOW);
}

beforeEach(() => {
  wipe();
  seed();
  writeFileSync(path.join(dir, "evidence", EVIDENCE), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

describe("preview", () => {
  it("counts each category and names the references that block a delete", () => {
    foodReferencedByDiary();
    db.prepare(
      `INSERT INTO plan_entries (id, plan_id, day, slot, position, recipe_version_id, servings, created_at)
       VALUES ('pe2', 'p1', '2026-11-17', 'dinner', 1, 'v1', 1, ?)`,
    ).run(NOW);

    const preview = purge.getPurgePreview();
    const byId = new Map(preview.categories.map((category) => [category.id, category]));

    expect(byId.get("diary")?.count).toBe(2);
    expect(byId.get("plans")?.count).toBe(1);
    expect(byId.get("plans")?.detail).toBe("2 planned meals");
    expect(byId.get("recipes")?.count).toBe(1);
    expect(byId.get("recipes")?.detail).toBe("1 version");
    expect(byId.get("foods")?.count).toBe(1);
    expect(byId.get("profile")?.count).toBe(1);
    expect(byId.get("preferences")?.count).toBe(2);
    expect(byId.get("ai")?.count).toBe(2);

    expect(byId.get("foods")?.blockers).toEqual([
      expect.objectContaining({ category: "diary", count: 1 }),
    ]);
    expect(byId.get("recipes")?.blockers).toEqual([
      expect.objectContaining({ category: "plans", count: 1 }),
    ]);
  });

  it("reports pinned amounts under foods as well", () => {
    const byId = new Map(purge.getPurgePreview().categories.map((category) => [category.id, category]));
    expect(byId.get("foods")?.detail).toContain("1 pinned amount");
  });

  it("reports nothing to block when no row references the parent", () => {
    const byId = new Map(purge.getPurgePreview().categories.map((category) => [category.id, category]));
    expect(byId.get("foods")?.blockers).toEqual([]);
    expect(byId.get("recipes")?.blockers).toEqual([]);
  });
});

describe("selective delete", () => {
  it("deletes only the selected category", () => {
    const result = purge.purgeData(["diary"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted.diary).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM plans")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM recipes")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(1);
  });

  it("normalises duplicate ids and reports the actual row count", () => {
    const result = purge.purgeData(["diary", "diary"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toEqual({ diary: 1 });
  });

  it("deletes recipes, versions, blocks and inputs together", () => {
    const result = purge.purgeData(["recipes"]);

    expect(result.ok).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM recipes")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM recipe_versions")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM components")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM component_inputs")).toBe(0);
  });
});

describe("references block a delete", () => {
  it("refuses foods while the diary still points at a captured food", () => {
    foodReferencedByDiary();

    const result = purge.purgeData(["foods"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked).toEqual(["foods"]);
    expect(result.blockers).toEqual([expect.objectContaining({ category: "diary", count: 1 })]);
    expect(result.message).toMatch(/still used by Diary entries/i);
    // The transaction rolled back: nothing was deleted.
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(2);
  });

  it("allows foods when the referencing diary category is selected too", () => {
    foodReferencedByDiary();

    const result = purge.purgeData(["diary", "foods"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesRemoved).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(0);
    expect(existsSync(path.join(dir, "evidence", EVIDENCE))).toBe(false);
    // The pin for the seed food is untouched; the pin for the deleted food is gone.
    expect(count("SELECT COUNT(*) AS n FROM food_default_amounts")).toBe(1);
  });

  it("refuses recipes while a plan pins a version", () => {
    db.prepare(
      `INSERT INTO plan_entries (id, plan_id, day, slot, position, recipe_version_id, servings, created_at)
       VALUES ('pe2', 'p1', '2026-11-17', 'dinner', 1, 'v1', 1, ?)`,
    ).run(NOW);

    const result = purge.purgeData(["recipes"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked).toEqual(["recipes"]);
    expect(result.blockers).toEqual([expect.objectContaining({ category: "plans", count: 1 })]);
    expect(count("SELECT COUNT(*) AS n FROM recipe_versions")).toBe(1);
  });

  it("allows recipes when the pinning plan is selected too", () => {
    db.prepare(
      `INSERT INTO plan_entries (id, plan_id, day, slot, position, recipe_version_id, servings, created_at)
       VALUES ('pe2', 'p1', '2026-11-17', 'dinner', 1, 'v1', 1, ?)`,
    ).run(NOW);

    const result = purge.purgeData(["plans", "recipes"]);

    expect(result.ok).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM plan_entries")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM recipe_versions")).toBe(0);
  });
  it("blocks foods when a v2 snapshot holds a disconnected food node", () => {
    db.prepare("UPDATE recipe_versions SET snapshot = ? WHERE id = 'v1'").run(
      JSON.stringify({ graph: { nodes: [{ type: "food", foodId: "f1", grams: 100 }] } }),
    );

    const result = purge.purgeData(["foods"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked).toEqual(["foods"]);
    expect(result.blockers).toEqual([expect.objectContaining({ category: "recipes", count: 1 })]);
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(1);

    const withRecipe = purge.purgeData(["foods", "recipes"]);
    expect(withRecipe.ok).toBe(true);
  });
});

describe("everything", () => {
  it("deletes every user category and keeps seed and app-managed data", () => {
    const seedFactors = count("SELECT COUNT(*) AS n FROM retention_factors WHERE origin = 'seed'");

    const result = purge.purgeData([
      "diary",
      "plans",
      "recipes",
      "foods",
      "defaults",
      "profile",
      "preferences",
      "ai",
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesRemoved).toBe(1);
    expect(existsSync(path.join(dir, "evidence", EVIDENCE))).toBe(false);

    for (const table of [
      "entries",
      "plan_entries",
      "plans",
      "component_inputs",
      "components",
      "recipe_versions",
      "recipes",
      "captured_food_nutrients",
      "captured_food_portions",
      "captured_foods",
      "food_default_amounts",
      "profile",
      "ai_calls",
      "estimate_cache",
    ]) {
      expect(count(`SELECT COUNT(*) AS n FROM ${table}`), table).toBe(0);
    }

    expect(count("SELECT COUNT(*) AS n FROM retention_factors WHERE origin = 'seed'")).toBe(
      seedFactors,
    );
    expect(count("SELECT COUNT(*) AS n FROM retention_factors WHERE origin = 'user'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM app_settings WHERE key = 'internal_future'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM meta WHERE key = 'created_at'")).toBe(1);
  });

  it("restores shipped retention factors that a user override suppressed", () => {
    // Remove the fixture and replace it with an override, the state the boot
    // seeder creates when the user edits a factor.
    db.prepare(
      "DELETE FROM retention_factors WHERE operation = 'boil' AND nutrient = 'VITC' AND qualifier = 'undrained' AND origin = 'seed'",
    ).run();
    db.prepare(
      `INSERT INTO retention_factors (id, operation, qualifier, nutrient, factor, source, notes, origin)
       VALUES ('u1', 'boil', NULL, 'VITC', 0.2, 'user', 'mine', 'user')`,
    ).run();
    expect(
      count(
        "SELECT COUNT(*) AS n FROM retention_factors WHERE operation = 'boil' AND nutrient = 'VITC' AND origin = 'user'",
      ),
    ).toBe(1);

    const result = purge.purgeData(["preferences"]);

    expect(result.ok).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM retention_factors WHERE origin = 'user'")).toBe(0);
    expect(
      count(
        "SELECT COUNT(*) AS n FROM retention_factors WHERE operation = 'boil' AND nutrient = 'VITC' AND origin = 'seed'",
      ),
    ).toBeGreaterThan(0);
  });
});

describe("invalid input", () => {
  it("rejects an unknown category and changes nothing", () => {
    const result = purge.purgeData(["diary", "everything"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/not recognised/i);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(1);
  });

  it("rejects an empty selection", () => {
    const result = purge.purgeData([]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/at least one/i);
  });
});

describe("action boundary", () => {
  it("rejects a payload that is not an array", async () => {
    const result = await actions.purgeDataAction("diary" as unknown as string[]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/not valid/i);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(1);
  });

  it("rejects an unknown id and still returns a preview", async () => {
    const result = await actions.purgeDataAction(["diary", "everything"]);

    expect(result.ok).toBe(false);
    expect(result.preview.categories.some((category) => category.id === "diary")).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(1);
  });

  it("returns the counts from after the delete", async () => {
    const result = await actions.purgeDataAction(["diary"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted.diary).toBe(1);
    expect(result.preview.categories.find((category) => category.id === "diary")?.count).toBe(0);
  });
});

describe("evidence files", () => {
  it("removes an orphaned evidence image that no row references", () => {
    const orphan = path.join(dir, "evidence", "orphan.png");
    writeFileSync(orphan, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = purge.purgeData(["foods"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesRemoved).toBe(2);
    expect(existsSync(orphan)).toBe(false);
  });

  it("never unlinks outside data/evidence, even with a hand-edited path", () => {
    const outside = path.join(dir, "outside.txt");
    writeFileSync(outside, "keep me");
    db.prepare(
      `INSERT INTO captured_foods (id, name, aliases, kind, state, source, image_path, created_at)
       VALUES ('f2', 'Crafted', '[]', 'provisional', 'raw', 'manual', 'data/evidence/../outside.txt', ?)`,
    ).run(NOW);

    const result = purge.purgeData(["foods"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The unsafe row is deleted with the category, but the file it pointed
    // at is not treated as evidence.
    expect(result.filesRemoved).toBe(1);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(path.join(dir, "evidence", EVIDENCE))).toBe(false);
  });
});
