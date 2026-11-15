import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Plan persistence.
 *
 * The promises under test: a plan entry points at a food *or* a pinned
 * recipe version, never both; changing the quantity never changes what
 * the entry points at; and a new recipe version does not rewrite a week
 * that was already planned (D-024).
 */
let dir: string;
let planRepo: typeof import("@/lib/db/plan");
let recipeRepo: typeof import("@/lib/db/recipes");
let service: typeof import("@/lib/recipes");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-plan-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  planRepo = await import("@/lib/db/plan");
  recipeRepo = await import("@/lib/db/recipes");
  service = await import("@/lib/recipes");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function draft(name: string) {
  return {
    name,
    instructions: "Mix.",
    servings: 2,
    blocks: [
      {
        name: "All",
        operation: "mix",
        inputs: [{ foodId: "paneer", amount: 200, unit: "g" }],
      },
    ],
  };
}

describe("plans", () => {
  it("does not create a week just by asking for it", () => {
    expect(planRepo.getPlan("2026-11-09")).toBeNull();
  });

  it("creates a week once and returns the same plan afterwards", () => {
    const first = planRepo.getOrCreatePlan("2026-11-09");
    const second = planRepo.getOrCreatePlan("2026-11-09");

    expect(second.id).toBe(first.id);
    expect(second.startsOn).toBe("2026-11-09");
    expect(planRepo.getPlan("2026-11-09")!.id).toBe(first.id);
  });
});

describe("plan entries", () => {
  it("adds a food with grams and lists it", () => {
    const plan = planRepo.getOrCreatePlan("2026-11-16");
    const before = planRepo.countPlanEntries(plan.id);

    const entry = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2026-11-16",
      slot: "breakfast",
      foodId: "paneer",
      grams: 120,
    });

    expect(entry.foodId).toBe("paneer");
    expect(entry.recipeVersionId).toBeNull();
    expect(entry.grams).toBe(120);
    expect(planRepo.countPlanEntries(plan.id)).toBe(before + 1);

    const listed = planRepo.listPlanEntries(plan.id);
    expect(listed.map((item) => item.id)).toContain(entry.id);
  });

  it("adds a pinned recipe version", () => {
    const saved = service.saveRecipeDraft(draft("Planned dish"));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const plan = planRepo.getOrCreatePlan("2026-11-23");
    const entry = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2026-11-23",
      slot: "dinner",
      recipeVersionId: saved.versionId,
      servings: 1.5,
    });

    expect(entry.recipeVersionId).toBe(saved.versionId);
    expect(entry.foodId).toBeNull();
    expect(entry.servings).toBe(1.5);
  });

  it("refuses an entry that is both a food and a recipe", () => {
    const plan = planRepo.getOrCreatePlan("2026-11-30");
    expect(() =>
      planRepo.addPlanEntry({
        planId: plan.id,
        day: "2026-11-30",
        slot: "lunch",
        foodId: "paneer",
        recipeVersionId: "some-version",
        grams: 100,
        servings: 1,
      }),
    ).toThrow(/either a food or a recipe/i);
  });

  it("refuses an entry that is neither", () => {
    const plan = planRepo.getOrCreatePlan("2026-11-30");
    expect(() =>
      planRepo.addPlanEntry({
        planId: plan.id,
        day: "2026-11-30",
        slot: "lunch",
      }),
    ).toThrow(/either a food or a recipe/i);
  });

  it("refuses a non-positive quantity", () => {
    const plan = planRepo.getOrCreatePlan("2026-12-07");
    expect(() =>
      planRepo.addPlanEntry({
        planId: plan.id,
        day: "2026-12-07",
        slot: "snack",
        foodId: "paneer",
        grams: 0,
      }),
    ).toThrow(/positive weight/i);

    const saved = service.saveRecipeDraft(draft("No servings"));
    if (!saved.ok) throw new Error("fixture failed");

    expect(() =>
      planRepo.addPlanEntry({
        planId: plan.id,
        day: "2026-12-07",
        slot: "snack",
        recipeVersionId: saved.versionId,
        servings: 0,
      }),
    ).toThrow(/positive number of servings/i);
  });

  it("updates a food's weight without touching what it points at", () => {
    const plan = planRepo.getOrCreatePlan("2026-12-14");
    const entry = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2026-12-14",
      slot: "lunch",
      foodId: "paneer",
      grams: 100,
    });

    planRepo.updatePlanEntryQuantity(entry.id, { grams: 250 });

    const updated = planRepo.listPlanEntries(plan.id).find((item) => item.id === entry.id)!;
    expect(updated.grams).toBe(250);
    expect(updated.foodId).toBe("paneer");
  });

  it("updates a recipe's servings without touching the pinned version", () => {
    const saved = service.saveRecipeDraft(draft("Quantity dish"));
    if (!saved.ok) throw new Error("fixture failed");

    const plan = planRepo.getOrCreatePlan("2026-12-21");
    const entry = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2026-12-21",
      slot: "dinner",
      recipeVersionId: saved.versionId,
      servings: 1,
    });

    planRepo.updatePlanEntryQuantity(entry.id, { servings: 2 });

    const updated = planRepo.listPlanEntries(plan.id).find((item) => item.id === entry.id)!;
    expect(updated.servings).toBe(2);
    expect(updated.recipeVersionId).toBe(saved.versionId);
  });

  it("moves an entry without changing what it points at or its quantity", () => {
    const saved = service.saveRecipeDraft(draft("Moved dish"));
    if (!saved.ok) throw new Error("fixture failed");

    const plan = planRepo.getOrCreatePlan("2027-01-04");
    const entry = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2027-01-04",
      slot: "breakfast",
      recipeVersionId: saved.versionId,
      servings: 2,
    });

    const moved = planRepo.movePlanEntry(entry.id, { day: "2027-01-06", slot: "dinner" });

    expect(moved.day).toBe("2027-01-06");
    expect(moved.slot).toBe("dinner");
    expect(moved.recipeVersionId).toBe(saved.versionId);
    expect(moved.servings).toBe(2);

    const stored = planRepo.listPlanEntries(plan.id).find((item) => item.id === entry.id)!;
    expect(stored).toEqual(moved);
  });

  it("puts a moved entry at the end of its destination", () => {
    const plan = planRepo.getOrCreatePlan("2027-01-11");
    const first = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2027-01-11",
      slot: "lunch",
      foodId: "curd",
      grams: 100,
    });
    const second = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2027-01-11",
      slot: "dinner",
      foodId: "paneer",
      grams: 100,
    });

    const moved = planRepo.movePlanEntry(second.id, { day: "2027-01-11", slot: "lunch" });
    expect(moved.position).toBeGreaterThan(first.position);
  });

  it("rejects a quantity of the wrong kind", () => {
    const plan = planRepo.getOrCreatePlan("2026-12-28");
    const entry = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2026-12-28",
      slot: "breakfast",
      foodId: "paneer",
      grams: 100,
    });

    expect(() => planRepo.updatePlanEntryQuantity(entry.id, { servings: 2 })).toThrow(
      /weight must be a positive number/i,
    );
  });

  it("removes an entry", () => {
    const plan = planRepo.getOrCreatePlan("2027-01-04");
    const entry = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2027-01-04",
      slot: "snack",
      foodId: "paneer",
      grams: 50,
    });

    planRepo.removePlanEntry(entry.id);
    expect(planRepo.listPlanEntries(plan.id).some((item) => item.id === entry.id)).toBe(false);
  });
});

describe("pinning", () => {
  it("keeps a planned week on the version it was planned with", () => {
    const first = service.saveRecipeDraft(draft("Pinned dish"));
    if (!first.ok) throw new Error("fixture failed");

    const plan = planRepo.getOrCreatePlan("2027-01-11");
    const entry = planRepo.addPlanEntry({
      planId: plan.id,
      day: "2027-01-11",
      slot: "lunch",
      recipeVersionId: first.versionId,
      servings: 1,
    });

    const before = recipeRepo.getVersion(first.versionId)!.snapshot.perServing.totals.ENERC_KCAL;

    const second = service.saveRecipeDraft({
      ...draft("Pinned dish"),
      recipeId: first.recipeId,
      servings: 6,
    });
    expect(second.ok).toBe(true);

    const stored = planRepo.listPlanEntries(plan.id).find((item) => item.id === entry.id)!;
    expect(stored.recipeVersionId).toBe(first.versionId);

    const after = recipeRepo.getVersion(stored.recipeVersionId!)!.snapshot.perServing.totals
      .ENERC_KCAL;
    expect(after).toBe(before);
  });

  it("offers every version of each recipe to the palette", () => {
    const options = recipeRepo.listRecipeOptions();
    expect(options.length).toBeGreaterThan(0);

    const recipeIds = [...new Set(options.map((option) => option.recipeId))];

    for (const recipeId of recipeIds) {
      const recipe = recipeRepo.getRecipe(recipeId)!;
      const offered = options.filter((option) => option.recipeId === recipeId);

      // Every stored version is offered, including the current one.
      expect(offered.map((option) => option.versionId).sort()).toEqual(
        recipe.versions.map((version) => version.id).sort(),
      );
      expect(offered.some((option) => option.versionId === recipe.summary.currentVersionId)).toBe(
        true,
      );
      expect(offered.filter((option) => option.isCurrent)).toHaveLength(1);
    }
  });

  it("keeps a version label with the version it names", () => {
    const saved = service.saveRecipeDraft({
      ...draft("Labelled dish"),
      versionLabel: "less salt",
    });
    if (!saved.ok) throw new Error("fixture failed");

    const version = recipeRepo.getVersion(saved.versionId)!;
    expect(version.label).toBe("less salt");

    const option = recipeRepo
      .listRecipeOptions()
      .find((entry) => entry.versionId === saved.versionId)!;
    expect(option.label).toBe("less salt");
  });
});
