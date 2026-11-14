import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Recipe persistence.
 *
 * The contract under test is the one the product promises (D-018,
 * D-024): saving twice produces two versions, and the first one never
 * changes. It is tested at the repository boundary because that is where
 * a careless update statement would break the promise.
 */
let dir: string;
let repo: typeof import("@/lib/db/recipes");
let service: typeof import("@/lib/recipes");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-recipes-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  repo = await import("@/lib/db/recipes");
  service = await import("@/lib/recipes");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function draft(overrides: Partial<Parameters<typeof service.saveRecipeDraft>[0]> = {}) {
  return {
    name: "Paneer bhurji",
    instructions: "Fry the onion, add the paneer.",
    servings: 2,
    blocks: [
      {
        name: "Prep",
        operation: "dice",
        inputs: [{ foodId: "onion", amount: 100, unit: "g" }],
      },
      {
        name: "Cook",
        operation: "fry",
        outputGrams: 250,
        inputs: [
          { foodId: "paneer", amount: 200, unit: "g" },
          { foodId: "mustard-oil", amount: 10, unit: "g" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("saving recipes", () => {
  it("creates a recipe with version 1 and a computed snapshot", () => {
    const saved = service.saveRecipeDraft(draft());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(saved.versionNo).toBe(1);

    const version = repo.getVersion(saved.versionId);
    expect(version).toBeDefined();
    expect(version!.recipeName).toBe("Paneer bhurji");
    expect(version!.servings).toBe(2);
    expect(version!.yieldGrams).toBe(250);
    expect(version!.blocks).toHaveLength(2);
    expect(version!.blocks[1].inputs).toHaveLength(2);
    expect(version!.snapshot.perServing.totals.ENERC_KCAL).toBeGreaterThan(0);
  });

  it("stores the resolved gram weight, not the user's unit", () => {
    const saved = service.saveRecipeDraft(
      draft({
        name: "Katori test",
        blocks: [
          {
            name: "All",
            inputs: [
              {
                foodId: "paneer",
                amount: 1,
                unit: "portion",
                portionLabel: "1 katori",
              },
            ],
          },
        ],
      }),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const version = repo.getVersion(saved.versionId)!;
    expect(version.blocks[0].inputs[0]).toMatchObject({
      grams: 100,
      amount: 1,
      unit: "portion:1 katori",
    });
  });

  it("produces a second version and leaves the first untouched", () => {
    const first = service.saveRecipeDraft(draft({ name: "Versioned dish" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const before = repo.getVersion(first.versionId)!;

    const second = service.saveRecipeDraft(
      draft({
        recipeId: first.recipeId,
        name: "Versioned dish",
        servings: 4,
      }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.versionNo).toBe(2);

    const after = repo.getVersion(first.versionId)!;
    expect(after.snapshot.perServing.totals.ENERC_KCAL).toEqual(
      before.snapshot.perServing.totals.ENERC_KCAL,
    );
    expect(after.servings).toBe(2);

    const latest = repo.getVersion(second.versionId)!;
    expect(latest.servings).toBe(4);
    expect(latest.snapshot.perServing.totals.ENERC_KCAL).toBeCloseTo(
      (before.snapshot.total.totals.ENERC_KCAL ?? 0) / 4,
      5,
    );
  });

  it("keeps the version history and marks the current one", () => {
    const saved = service.saveRecipeDraft(draft({ name: "History dish" }));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    service.saveRecipeDraft(draft({ recipeId: saved.recipeId, name: "History dish" }));

    const recipe = repo.getRecipe(saved.recipeId)!;
    expect(recipe.versions).toHaveLength(2);
    expect(recipe.versions.filter((version) => version.isCurrent)).toHaveLength(1);
    expect(recipe.versions[0].versionNo).toBe(2);
    expect(recipe.summary.versionCount).toBe(2);
  });

  it("renames the recipe on a new version", () => {
    const saved = service.saveRecipeDraft(draft({ name: "Old name" }));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    service.saveRecipeDraft(draft({ recipeId: saved.recipeId, name: "New name" }));

    expect(repo.getRecipe(saved.recipeId)!.summary.name).toBe("New name");
  });

  it("rejects a draft with no ingredients", () => {
    const result = service.saveRecipeDraft(draft({ name: "Empty", blocks: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/at least one ingredient/i);
  });

  it("rejects a recipe without a name", () => {
    const result = service.saveRecipeDraft(draft({ name: "   " }));
    expect(result.ok).toBe(false);
  });

  it("rejects a portion that does not exist", () => {
    const result = service.saveRecipeDraft(
      draft({
        name: "Bad portion",
        blocks: [
          {
            name: "All",
            inputs: [{ foodId: "paneer", amount: 1, unit: "portion", portionLabel: "1 bucket" }],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown food", () => {
    const result = service.saveRecipeDraft(
      draft({
        name: "Unknown food",
        blocks: [{ name: "All", inputs: [{ foodId: "unicorn", amount: 100, unit: "g" }] }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("lists recipes newest first", () => {
    const before = repo.listRecipes().length;
    service.saveRecipeDraft(draft({ name: "Newest dish" }));

    const recipes = repo.listRecipes();
    expect(recipes).toHaveLength(before + 1);
    expect(recipes[0].name).toBe("Newest dish");
  });
});
