import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Deleting user data by category.
 *
 * The promises under test:
 *
 *   1. a scope only accepts its own categories: a person purge cannot delete
 *      shared recipes or foods, and a household purge cannot delete someone's
 *      diary;
 *   2. a category deletes exactly the rows it names, and nothing else;
 *   3. shared parents are refused while any person still references them,
 *      with the blocker attributed to that person — one person clearing
 *      their own diary does not waive another person's reference;
 *   4. evidence files follow a household foods delete, but a hand-edited path
 *      cannot escape `data/evidence`, and a person purge never touches files;
 *   5. seed foods, seed retention factors, `meta`, the people roster and
 *      non-importable settings survive every selection.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

let dir: string;
let personId: string;
let otherId: string;
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
  const people = await import("@/lib/db/people");
  personId = people.defaultPersonId();
  otherId = people.createPerson({ displayName: "Priya" }).id;

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
    DELETE FROM person_settings;
    DELETE FROM app_settings;
    DELETE FROM retention_factors WHERE origin = 'user';
  `);
}

function seed(): void {
  db.prepare(
    `INSERT INTO profile (id, sex, age_years, height_cm, weight_kg, activity, goal, pace, updated_at)
     VALUES (?, 'male', 30, 175, 70, 'moderate', 'maintain', 'steady', ?)`,
  ).run(personId, NOW);

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

  db.prepare(
    `INSERT INTO plans (id, person_id, starts_on, created_at) VALUES ('p1', ?, '2026-11-16', ?)`,
  ).run(personId, NOW);
  db.prepare(
    `INSERT INTO plan_entries (id, plan_id, day, slot, position, food_id, grams, amount, unit, created_at)
     VALUES ('pe1', 'p1', '2026-11-16', 'lunch', 0, 'paneer', 100, 100, 'g', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO entries (id, person_id, food_id, grams, amount, unit, day, created_at)
     VALUES ('e1', ?, 'paneer', 100, 100, 'g', '2026-11-16', ?)`,
  ).run(personId, NOW);

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
    `INSERT INTO food_default_amounts (person_id, food_id, amount, unit, updated_at)
     VALUES (?, 'f1', 1, 'katori', ?)`,
  ).run(personId, NOW);
  // A pin for a seed food must survive deleting captured foods.
  db.prepare(
    `INSERT INTO food_default_amounts (person_id, food_id, amount, unit, updated_at)
     VALUES (?, 'paneer', 100, 'g', ?)`,
  ).run(personId, NOW);

  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('ai_master_prompt', 'Home food.')`).run();
  db.prepare(
    `INSERT INTO person_settings (person_id, key, value, updated_at)
     VALUES (?, 'target_rules', '{}', ?)`,
  ).run(personId, NOW);
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

function count(sql: string, ...params: Array<string | number>): number {
  return (db.prepare(sql).get(...params) as unknown as { n: number }).n;
}

function foodReferencedByDiary(person = personId, id = "e2"): void {
  db.prepare(
    `INSERT INTO entries (id, person_id, food_id, grams, amount, unit, day, created_at)
     VALUES (?, ?, 'f1', 150, 1, 'portion:katori', '2026-11-17', ?)`,
  ).run(id, person, NOW);
}

function versionPinnedByPlan(person = personId, id = "pe2"): void {
  const planId = person === personId ? "p1" : `p-${person}`;
  if (person !== personId) {
    db.prepare(
      `INSERT INTO plans (id, person_id, starts_on, created_at)
       VALUES (?, ?, '2026-11-16', ?)`,
    ).run(planId, person, NOW);
  }
  db.prepare(
    `INSERT INTO plan_entries (id, plan_id, day, slot, position, recipe_version_id, servings, created_at)
     VALUES (?, ?, '2026-11-17', 'dinner', 1, 'v1', 1, ?)`,
  ).run(id, planId, NOW);
}

beforeEach(() => {
  wipe();
  seed();
  writeFileSync(path.join(dir, "evidence", EVIDENCE), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

describe("preview", () => {
  it("counts person and household categories separately", () => {
    foodReferencedByDiary();
    versionPinnedByPlan();

    const personal = purge.getPurgePreview("person", personId);
    const byPerson = new Map(personal.categories.map((category) => [category.id, category]));
    expect(personal.personId).toBe(personId);
    expect(byPerson.get("diary")?.count).toBe(2);
    expect(byPerson.get("plans")?.count).toBe(1);
    expect(byPerson.get("plans")?.detail).toBe("2 planned meals");
    expect(byPerson.get("profile")?.count).toBe(1);
    expect(byPerson.get("defaults")?.count).toBe(2);
    expect(byPerson.get("preferences")?.count).toBe(1);
    expect(byPerson.get("recipes")).toBeUndefined();
    expect(byPerson.get("foods")).toBeUndefined();

    const household = purge.getPurgePreview("household");
    const byHousehold = new Map(household.categories.map((category) => [category.id, category]));
    expect(household.personId).toBeNull();
    expect(byHousehold.get("recipes")?.count).toBe(1);
    expect(byHousehold.get("recipes")?.detail).toBe("1 version");
    expect(byHousehold.get("foods")?.count).toBe(1);
    expect(byHousehold.get("preferences")?.count).toBe(1);
    expect(byHousehold.get("ai")?.count).toBe(2);
    expect(byHousehold.get("diary")).toBeUndefined();

    expect(byHousehold.get("foods")?.blockers).toEqual([
      expect.objectContaining({
        category: "diary",
        count: 1,
        personId,
        resolvable: false,
      }),
    ]);
    expect(byHousehold.get("recipes")?.blockers).toEqual([
      expect.objectContaining({
        category: "plans",
        count: 1,
        personId,
        resolvable: false,
      }),
    ]);
  });

  it("reports pinned amounts under foods as well", () => {
    const byId = new Map(
      purge.getPurgePreview("household").categories.map((category) => [category.id, category]),
    );
    expect(byId.get("foods")?.detail).toContain("1 pinned amount");
  });

  it("reports nothing to block when no row references the parent", () => {
    const byId = new Map(
      purge.getPurgePreview("household").categories.map((category) => [category.id, category]),
    );
    expect(byId.get("foods")?.blockers).toEqual([]);
    expect(byId.get("recipes")?.blockers).toEqual([]);
  });
});

describe("selective delete", () => {
  it("deletes only the selected person category", () => {
    const result = purge.purgeData("person", personId, ["diary"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted.diary).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM plans")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM recipes")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(1);
  });

  it("normalises duplicate ids and reports the actual row count", () => {
    const result = purge.purgeData("person", personId, ["diary", "diary"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deleted).toEqual({ diary: 1 });
  });

  it("deletes recipes, versions, blocks and inputs together", () => {
    const result = purge.purgeData("household", null, ["recipes"]);

    expect(result.ok).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM recipes")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM recipe_versions")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM components")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM component_inputs")).toBe(0);
  });

  it("a person purge leaves another person's rows and the shared library alone", () => {
    db.prepare(
      `INSERT INTO profile (id, sex, age_years, height_cm, weight_kg, activity, goal, pace, updated_at)
       VALUES (?, 'female', 28, 160, 55, 'light', 'lose', 'gentle', ?)`,
    ).run(otherId, NOW);
    foodReferencedByDiary(otherId, "e-other");
    db.prepare(
      `INSERT INTO plans (id, person_id, starts_on, created_at)
       VALUES ('p-other', ?, '2026-11-16', ?)`,
    ).run(otherId, NOW);
    db.prepare(
      `INSERT INTO food_default_amounts (person_id, food_id, amount, unit, updated_at)
       VALUES (?, 'f1', 2, 'katori', ?)`,
    ).run(otherId, NOW);
    db.prepare(
      `INSERT INTO person_settings (person_id, key, value, updated_at)
       VALUES (?, 'target_rules', '{"amberOver":0.2}', ?)`,
    ).run(otherId, NOW);

    const result = purge.purgeData("person", personId, [
      "diary",
      "plans",
      "profile",
      "defaults",
      "preferences",
    ]);

    expect(result.ok).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?", personId)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM entries WHERE person_id = ?", otherId)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?", personId)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM plans WHERE person_id = ?", otherId)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM profile WHERE id = ?", otherId)).toBe(1);
    expect(
      count("SELECT COUNT(*) AS n FROM food_default_amounts WHERE person_id = ?", otherId),
    ).toBe(1);
    expect(
      count("SELECT COUNT(*) AS n FROM person_settings WHERE person_id = ?", otherId),
    ).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(1);
  });
});

describe("references block a delete", () => {
  it("refuses foods while any person's diary still points at a captured food", () => {
    foodReferencedByDiary();

    const result = purge.purgeData("household", null, ["foods"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked).toEqual(["foods"]);
    expect(result.blockers).toEqual([
      expect.objectContaining({ category: "diary", count: 1, personId }),
    ]);
    expect(result.message).toMatch(/still used by .*diary entries/i);
    // The transaction rolled back: nothing was deleted.
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(2);
  });

  it("refuses foods after one person clears their diary if another still references it", () => {
    foodReferencedByDiary(personId, "e-mine");
    foodReferencedByDiary(otherId, "e-theirs");

    expect(purge.purgeData("person", personId, ["diary"]).ok).toBe(true);

    const result = purge.purgeData("household", null, ["foods"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers).toEqual([
      expect.objectContaining({ category: "diary", count: 1, personId: otherId }),
    ]);

    expect(purge.purgeData("person", otherId, ["diary"]).ok).toBe(true);
    const then = purge.purgeData("household", null, ["foods"]);
    expect(then.ok).toBe(true);
  });

  it("allows foods once the referencing diary has been cleared", () => {
    foodReferencedByDiary();
    expect(purge.purgeData("person", personId, ["diary"]).ok).toBe(true);

    const result = purge.purgeData("household", null, ["foods"]);

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
    versionPinnedByPlan();

    const result = purge.purgeData("household", null, ["recipes"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked).toEqual(["recipes"]);
    expect(result.blockers).toEqual([
      expect.objectContaining({ category: "plans", count: 1, personId }),
    ]);
    expect(count("SELECT COUNT(*) AS n FROM recipe_versions")).toBe(1);
  });

  it("allows recipes once the pinning plans have been cleared", () => {
    versionPinnedByPlan();
    expect(purge.purgeData("person", personId, ["plans"]).ok).toBe(true);

    const result = purge.purgeData("household", null, ["recipes"]);

    expect(result.ok).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM plan_entries")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM recipe_versions")).toBe(0);
  });

  it("blocks foods when a v2 snapshot holds a disconnected food node", () => {
    db.prepare("UPDATE recipe_versions SET snapshot = ? WHERE id = 'v1'").run(
      JSON.stringify({ graph: { nodes: [{ type: "food", foodId: "f1", grams: 100 }] } }),
    );

    const result = purge.purgeData("household", null, ["foods"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked).toEqual(["foods"]);
    expect(result.blockers).toEqual([
      expect.objectContaining({ category: "recipes", count: 1, resolvable: true }),
    ]);
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(1);

    const withRecipe = purge.purgeData("household", null, ["foods", "recipes"]);
    expect(withRecipe.ok).toBe(true);
  });
});

describe("everything", () => {
  it("deletes every user category and keeps seed and app-managed data", () => {
    const seedFactors = count("SELECT COUNT(*) AS n FROM retention_factors WHERE origin = 'seed'");

    const personal = purge.purgeData("person", personId, [
      "diary",
      "plans",
      "profile",
      "defaults",
      "preferences",
    ]);
    expect(personal.ok).toBe(true);

    const household = purge.purgeData("household", null, [
      "recipes",
      "foods",
      "preferences",
      "ai",
    ]);

    expect(household.ok).toBe(true);
    if (!household.ok) return;
    expect(household.filesRemoved).toBe(1);
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
      "person_settings",
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
    // The roster is not content: a purge never removes a person.
    expect(count("SELECT COUNT(*) AS n FROM people")).toBe(2);
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

    const result = purge.purgeData("household", null, ["preferences"]);

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
    const result = purge.purgeData("person", personId, ["diary", "everything"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/not recognised/i);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(1);
  });

  it("rejects a household category in the person scope", () => {
    const result = purge.purgeData("person", personId, ["foods"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/not recognised/i);
    expect(count("SELECT COUNT(*) AS n FROM captured_foods")).toBe(1);
  });

  it("rejects a person category in the household scope", () => {
    const result = purge.purgeData("household", null, ["diary"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/not recognised/i);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(1);
  });

  it("rejects an empty selection", () => {
    const result = purge.purgeData("person", personId, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/at least one/i);
  });
});

describe("action boundary", () => {
  it("rejects a payload that is not an array", async () => {
    const result = await actions.purgeDataAction(
      "person",
      "diary" as unknown as string[],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/not valid/i);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(1);
  });

  it("rejects an unknown id and still returns a preview", async () => {
    const result = await actions.purgeDataAction("person", ["diary", "everything"]);

    expect(result.ok).toBe(false);
    expect(result.preview.categories.some((category) => category.id === "diary")).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM entries")).toBe(1);
  });

  it("returns the counts from after the delete", async () => {
    const result = await actions.purgeDataAction("person", ["diary"]);

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

    const result = purge.purgeData("household", null, ["foods"]);

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

    const result = purge.purgeData("household", null, ["foods"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The unsafe row is deleted with the category, but the file it pointed
    // at is not treated as evidence.
    expect(result.filesRemoved).toBe(1);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(path.join(dir, "evidence", EVIDENCE))).toBe(false);
  });

  it("a person purge never touches evidence files", () => {
    const before = existsSync(path.join(dir, "evidence", EVIDENCE));

    const result = purge.purgeData("person", personId, ["defaults"]);

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(dir, "evidence", EVIDENCE))).toBe(before);
  });
});
