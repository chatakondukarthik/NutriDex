import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_PROFILE } from "@/lib/profile";
import { DEFAULT_TARGET_RULES } from "@/lib/targets";

/**
 * The household roster and person scoping (D-051).
 *
 * People are convenience scopes, not accounts. The tests below pin the two
 * properties the rest of the app relies on:
 *
 *   1. the roster can grow, rename, archive and hard-delete people without
 *      ever leaving the household with no active person;
 *   2. every personal repository filters by person id, while foods and
 *      recipes stay shared by everyone.
 *
 * Person ids are deliberately treated as filters, not authorization: the
 * household is trusted, so the promise is "this call cannot touch another
 * person's rows by accident or with a stale id", not "members cannot read
 * each other's data".
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));

let dir: string;
let db: typeof import("@/lib/db/client")["db"];
let people: typeof import("@/lib/db/people");
let entries: typeof import("@/lib/db/entries");
let plan: typeof import("@/lib/db/plan");
let profile: typeof import("@/lib/db/profile");
let settings: typeof import("@/lib/db/settings");
let defaults: typeof import("@/lib/db/defaults");
let foods: typeof import("@/lib/db/foods");
let recipes: typeof import("@/lib/db/recipes");
let captured: typeof import("@/lib/captured-food");
let a: string;
let b: string;

const NOW = "2026-11-18T10:00:00.000Z";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-people-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  vi.stubEnv("NUTRIPLAN_DATA_DIR", dir);

  db = (await import("@/lib/db/client")).db;
  people = await import("@/lib/db/people");
  entries = await import("@/lib/db/entries");
  plan = await import("@/lib/db/plan");
  profile = await import("@/lib/db/profile");
  settings = await import("@/lib/db/settings");
  defaults = await import("@/lib/db/defaults");
  foods = await import("@/lib/db/foods");
  recipes = await import("@/lib/db/recipes");
  captured = await import("@/lib/captured-food");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // Children before parents. Shared rows are cleared too so one test cannot
  // change what the next one sees.
  db.exec(`
    DELETE FROM plan_entries;
    DELETE FROM plans;
    DELETE FROM entries;
    DELETE FROM food_default_amounts;
    DELETE FROM person_settings;
    DELETE FROM profile;
    DELETE FROM component_inputs;
    DELETE FROM components;
    DELETE FROM recipe_versions;
    DELETE FROM recipes;
    DELETE FROM captured_food_nutrients;
    DELETE FROM captured_food_portions;
    DELETE FROM captured_foods;
    DELETE FROM people;
  `);
  people.ensureHousehold();
  a = people.defaultPersonId();
  b = people.createPerson({ displayName: "Priya" }).id;
});

function seedPersonal(personId: string): void {
  profile.saveProfile(personId, { ...DEFAULT_PROFILE, ageYears: 31 });
  settings.setTargetRules(personId, { amberOver: 0.1 });
  defaults.setFoodDefaultPin(personId, "paneer", { amount: 100, unit: "g" });

  const week = plan.getOrCreatePlan(personId, "2026-11-16");
  plan.addPlanEntry(personId, {
    planId: week.id,
    day: "2026-11-16",
    slot: "lunch",
    foodId: "paneer",
    grams: 100,
    amount: 100,
    unit: "g",
  });
  entries.addEntry(personId, {
    foodId: "paneer",
    grams: 100,
    amount: 100,
    unit: "g",
    day: "2026-11-16",
  });
}

function seedSharedFood(createdBy: string): string {
  const prepared = captured.prepareCapturedFood({ name: "Poha" });
  if (!prepared.ok) throw new Error(prepared.message);
  const saved = foods.saveCapturedFood(prepared.food, { createdBy });
  if (!saved.ok) throw new Error(saved.message);
  return saved.food.id;
}

function seedSharedRecipe(): string {
  db.prepare(
    `INSERT INTO recipes (id, kind, name, current_version_id, created_at, updated_at)
     VALUES ('r1', 'dish', 'Dal', 'v1', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO recipe_versions (id, recipe_id, version_no, instructions, servings, yield_g,
       snapshot, calculation_version, label, created_at)
     VALUES ('v1', 'r1', 1, 'Boil, then temper.', 2, 500, ?, '2', 'trial', ?)`,
  ).run(JSON.stringify({ perServing: { totals: { ENERC_KCAL: 210 } } }), NOW);
  db.prepare(
    `INSERT INTO components (id, recipe_version_id, position, name, operation, output_g)
     VALUES ('c1', 'v1', 0, 'Base', 'boil', 500)`,
  ).run();
  return "v1";
}

describe("roster", () => {
  it("starts with one household and one person", () => {
    const roster = people.listPeople();
    expect(roster.map((person) => person.displayName)).toEqual(["Me", "Priya"]);
    expect(new Set(roster.map((person) => person.householdId)).size).toBe(1);
    expect(people.getHousehold().name).toBe("Household");
  });

  it("trims and collapses a new person's name", () => {
    const created = people.createPerson({ displayName: "  Priya   Sharma  " });
    expect(created.displayName).toBe("Priya Sharma");
    expect(people.getPerson(created.id)?.displayName).toBe("Priya Sharma");
  });

  it("rejects an empty or overlong name", () => {
    expect(() => people.createPerson({ displayName: "   " })).toThrow(/needs a name/i);
    expect(() => people.createPerson({ displayName: "x".repeat(61) })).toThrow(/60 characters/i);
    expect(() => people.updatePerson(a, { displayName: "" })).toThrow(/needs a name/i);
  });

  it("renames one person without touching the other", () => {
    people.updatePerson(b, { displayName: "Priya S." });
    expect(people.getPerson(b)?.displayName).toBe("Priya S.");
    expect(people.getPerson(a)?.displayName).toBe("Me");
  });

  it("archives a person without deleting their rows", () => {
    seedPersonal(b);

    people.archivePerson(b);

    expect(people.getPerson(b)?.archivedAt).not.toBeNull();
    expect(people.listPeople().map((person) => person.id)).not.toContain(b);
    expect(people.listPeople({ includeArchived: true }).map((person) => person.id)).toContain(b);
    expect(entries.countEntriesForPerson(b)).toBe(1);

    people.unarchivePerson(b);
    expect(people.getPerson(b)?.archivedAt).toBeNull();
    expect(people.listPeople().map((person) => person.id)).toContain(b);
  });

  it("refuses to archive the last active person", () => {
    people.archivePerson(b);
    expect(() => people.archivePerson(a)).toThrow(/last active person/i);
    // Archiving the same person twice is a no-op, not an error.
    expect(() => people.archivePerson(b)).not.toThrow();
  });

  it("hard-deletes only that person's rows and keeps shared content", () => {
    seedPersonal(a);
    seedPersonal(b);
    const foodId = seedSharedFood(b);
    seedSharedRecipe();

    people.deletePerson(b);

    expect(people.getPerson(b)).toBeNull();
    expect(entries.countEntriesForPerson(b)).toBe(0);
    expect(plan.getPlan(b, "2026-11-16")).toBeNull();
    expect(profile.getProfile(b)).toEqual(DEFAULT_PROFILE);
    expect(defaults.countDefaultPinsForPerson(b)).toBe(0);

    // The other person and the shared library are untouched.
    expect(entries.countEntriesForPerson(a)).toBe(1);
    expect(plan.getPlan(a, "2026-11-16")).not.toBeNull();
    expect(profile.getProfile(a).ageYears).toBe(31);
    expect(foods.getCapturedFood(foodId)?.name).toBe("Poha");
    expect(recipes.listRecipes().map((recipe) => recipe.id)).toEqual(["r1"]);
  });

  it("refuses to delete the only person and the last active person", () => {
    people.deletePerson(b);
    expect(() => people.deletePerson(a)).toThrow(/only person/i);

    const c = people.createPerson({ displayName: "Third" });
    people.archivePerson(c.id);
    expect(() => people.deletePerson(a)).toThrow(/last active person/i);
  });

  it("counts the rows a hard delete would remove", () => {
    seedPersonal(b);
    expect(people.personDeletionCounts(b)).toEqual({
      diaryEntries: 1,
      plans: 1,
      planEntries: 1,
      pins: 1,
    });
    expect(people.personDeletionCounts(a)).toEqual({
      diaryEntries: 0,
      plans: 0,
      planEntries: 0,
      pins: 0,
    });
  });

  it("repairs an empty roster instead of crashing", () => {
    db.exec("DELETE FROM people");
    expect(people.listPeople()).toEqual([]);

    const repaired = people.defaultPersonId();
    expect(people.listPeople().map((person) => person.id)).toEqual([repaired]);
    expect(people.getPerson(repaired)?.displayName).toBe("Me");
  });

  it("opens as the archived person only when no active person exists", () => {
    db.prepare("UPDATE people SET archived_at = ?").run(NOW);
    const fallback = people.defaultPersonId();
    expect(people.getPerson(fallback)?.archivedAt).toBe(NOW);
  });
});

describe("personal scoping", () => {
  it("keeps diaries separate", () => {
    entries.addEntry(a, {
      foodId: "paneer",
      grams: 100,
      amount: 100,
      unit: "g",
      day: "2026-11-18",
    });
    entries.addEntry(b, {
      foodId: "paneer",
      grams: 50,
      amount: 50,
      unit: "g",
      day: "2026-11-18",
    });

    expect(entries.listEntries(a, "2026-11-18").map((row) => row.grams)).toEqual([100]);
    expect(entries.listEntries(b, "2026-11-18").map((row) => row.grams)).toEqual([50]);
  });

  it("lets two people plan the same week but not the same person twice", () => {
    const first = plan.getOrCreatePlan(a, "2026-11-16");
    const second = plan.getOrCreatePlan(b, "2026-11-16");
    expect(first.id).not.toBe(second.id);
    expect(first.personId).toBe(a);
    expect(second.personId).toBe(b);

    expect(plan.getOrCreatePlan(a, "2026-11-16").id).toBe(first.id);
    expect(() =>
      db
        .prepare(
          `INSERT INTO plans (id, person_id, starts_on, created_at)
           VALUES ('duplicate', ?, '2026-11-16', ?)`,
        )
        .run(a, NOW),
    ).toThrow(/UNIQUE/i);
  });

  it("refuses to write into another person's plan", () => {
    const own = plan.getOrCreatePlan(a, "2026-11-16");

    expect(plan.listPlanEntries(b, own.id)).toEqual([]);
    expect(() =>
      plan.addPlanEntry(b, {
        planId: own.id,
        day: "2026-11-16",
        slot: "lunch",
        foodId: "paneer",
        grams: 100,
        amount: 100,
        unit: "g",
      }),
    ).toThrow(/plan no longer exists/i);
    expect(plan.countPlanEntries(a, own.id)).toBe(0);
  });

  it("refuses another person's plan entry by id", () => {
    const week = plan.getOrCreatePlan(a, "2026-11-16");
    const entry = plan.addPlanEntry(a, {
      planId: week.id,
      day: "2026-11-16",
      slot: "lunch",
      foodId: "paneer",
      grams: 100,
      amount: 100,
      unit: "g",
    });

    expect(() => plan.updatePlanEntryQuantity(b, entry.id, { grams: 50 })).toThrow(
      /no longer exists/i,
    );
    expect(() =>
      plan.movePlanEntry(b, entry.id, { day: "2026-11-17", slot: "dinner" }),
    ).toThrow(/no longer exists/i);
    expect(() => plan.removePlanEntry(b, entry.id)).toThrow(/no longer exists/i);

    expect(plan.listPlanEntries(a, week.id)[0]).toMatchObject({
      id: entry.id,
      grams: 100,
      day: "2026-11-16",
    });
  });

  it("removes only the acting person's diary row", () => {
    const own = entries.addEntry(a, {
      foodId: "paneer",
      grams: 100,
      amount: 100,
      unit: "g",
      day: "2026-11-18",
    });

    expect(() => entries.removeEntry(b, own.id)).toThrow(/no longer exists/i);
    expect(entries.countEntriesForPerson(a)).toBe(1);

    entries.removeEntry(a, own.id);
    expect(entries.countEntriesForPerson(a)).toBe(0);
  });

  it("keeps body profiles and thresholds separate", () => {
    profile.saveProfile(a, { ...DEFAULT_PROFILE, weightKg: 70, targetEnergyKcal: 2100 });
    profile.saveProfile(b, { ...DEFAULT_PROFILE, weightKg: 55, targetEnergyKcal: 1700 });
    settings.setTargetRules(a, { amberOver: 0.15, redAt: 0.35 });

    expect(profile.getProfile(a)).toMatchObject({ weightKg: 70, targetEnergyKcal: 2100 });
    expect(profile.getProfile(b)).toMatchObject({ weightKg: 55, targetEnergyKcal: 1700 });
    expect(settings.getTargetRules(a).amberOver).toBe(0.15);
    // The untouched person still has the documented defaults.
    expect(settings.getTargetRules(b)).toEqual(DEFAULT_TARGET_RULES);
  });

  it("keeps pins and last-used amounts separate", () => {
    defaults.setFoodDefaultPin(a, "paneer", { amount: 100, unit: "g" });
    defaults.setFoodDefaultPin(b, "paneer", { amount: 1, unit: "katori" });

    expect(defaults.getFoodDefaultPin(a, "paneer")).toEqual({ amount: 100, unit: "g" });
    expect(defaults.getFoodDefaultPin(b, "paneer")).toEqual({ amount: 1, unit: "katori" });

    entries.addEntry(a, {
      foodId: "paneer",
      grams: 150,
      amount: 150,
      unit: "g",
      day: "2026-11-18",
    });

    expect(defaults.lastUsedAmountFor(a, "paneer")).toEqual({ amount: 150, unit: "g" });
    expect(defaults.lastUsedAmountFor(b, "paneer")).toBeNull();

    defaults.setFoodDefaultPin(a, "paneer", null);
    expect(defaults.getFoodDefaultPin(a, "paneer")).toBeNull();
    expect(defaults.getFoodDefaultPin(b, "paneer")).toEqual({ amount: 1, unit: "katori" });
  });

  it("shares captured foods by creating them once and using them from both diaries", () => {
    const foodId = seedSharedFood(a);

    expect(foods.getCapturedFood(foodId)?.name).toBe("Poha");
    expect(foods.listFoods().map((food) => food.id)).toContain(foodId);

    for (const person of [a, b]) {
      entries.addEntry(person, {
        foodId,
        grams: 150,
        amount: 1,
        unit: "katori",
        day: "2026-11-18",
      });
    }

    expect(entries.listEntries(a, "2026-11-18")[0].foodId).toBe(foodId);
    expect(entries.listEntries(b, "2026-11-18")[0].foodId).toBe(foodId);
  });

  it("shares a recipe version but not the defaults derived from ingredients", () => {
    const versionId = seedSharedRecipe();
    expect(recipes.listRecipes().map((recipe) => recipe.id)).toEqual(["r1"]);

    // A shared recipe's ingredient line is library content, so it must not
    // become one person's "last used" default (D-051).
    db.prepare(
      `INSERT INTO component_inputs
         (id, component_id, position, food_id, grams, amount, unit)
       VALUES ('i1', 'c1', 0, 'paneer', 200, 1, 'cup')`,
    ).run();
    expect(defaults.lastUsedAmountFor(a, "paneer")).toBeNull();
    expect(defaults.lastUsedAmountFor(b, "paneer")).toBeNull();

    for (const person of [a, b]) {
      entries.addRecipeEntry(person, {
        recipeVersionId: versionId,
        servings: 1,
        grams: 250,
        amount: 1,
        unit: "serving",
        day: "2026-11-18",
      });
    }

    expect(entries.listEntries(a, "2026-11-18")[0].recipeVersionId).toBe(versionId);
    expect(entries.listEntries(b, "2026-11-18")[0].recipeVersionId).toBe(versionId);
  });
});
