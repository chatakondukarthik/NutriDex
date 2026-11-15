import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The per-version lifecycle: delete one version, promote another.
 *
 * The promises under test: the only remaining version cannot be deleted;
 * a version pinned by a plan or a diary entry cannot be deleted or
 * replaced; deleting the current version promotes the next-highest one;
 * promoting an arbitrary version changes only where new logs come from.
 */
let dir: string;
let recipeRepo: typeof import("@/lib/db/recipes");
let service: typeof import("@/lib/recipes");
let planRepo: typeof import("@/lib/db/plan");
let entries: typeof import("@/lib/db/entries");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-versions-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  recipeRepo = await import("@/lib/db/recipes");
  service = await import("@/lib/recipes");
  planRepo = await import("@/lib/db/plan");
  entries = await import("@/lib/db/entries");
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

function twoVersionRecipe(name: string) {
  const first = service.saveRecipeDraft({ ...draft(name) });
  if (!first.ok) throw new Error("first version did not save");
  const second = service.saveRecipeDraft({ ...draft(name), recipeId: first.recipeId });
  if (!second.ok) throw new Error("second version did not save");
  return { recipeId: first.recipeId, v1: first.versionId, v2: second.versionId };
}

function pinWithPlanEntry(versionId: string) {
  const plan = planRepo.getOrCreatePlan("2030-05-04");
  planRepo.addPlanEntry({
    planId: plan.id,
    day: "2030-05-04",
    slot: "lunch",
    recipeVersionId: versionId,
    servings: 1,
  });
}

describe("deleteVersion", () => {
  it("refuses to delete the only remaining version", () => {
    const saved = service.saveRecipeDraft({ ...draft("Lone version") });
    if (!saved.ok) throw new Error("save failed");

    const result = recipeRepo.deleteVersion(saved.versionId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/only version/i);
  });

  it("promotes the next-highest version when the current one is deleted", () => {
    const { recipeId, v1, v2 } = twoVersionRecipe("Promote on delete");
    expect(recipeRepo.getRecipe(recipeId)?.summary.currentVersionId).toBe(v2);

    const result = recipeRepo.deleteVersion(v2);
    expect(result.ok).toBe(true);
    expect(recipeRepo.getRecipe(recipeId)?.summary.currentVersionId).toBe(v1);
  });

  it("keeps the current pointer when an older version is deleted", () => {
    const { recipeId, v1, v2 } = twoVersionRecipe("Delete older");

    expect(recipeRepo.deleteVersion(v1).ok).toBe(true);
    expect(recipeRepo.getRecipe(recipeId)?.summary.currentVersionId).toBe(v2);
  });

  it("refuses a version pinned by a plan entry", () => {
    const { v1 } = twoVersionRecipe("Pinned in plan");
    pinWithPlanEntry(v1);

    const result = recipeRepo.deleteVersion(v1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/used by/i);
  });

  it("refuses a version pinned by a diary entry", () => {
    const { v1 } = twoVersionRecipe("Pinned in diary");
    entries.addRecipeEntry({
      recipeVersionId: v1,
      servings: 1,
      grams: 150,
      amount: 1,
      unit: "serving",
      day: "2030-05-05",
    });

    const result = recipeRepo.deleteVersion(v1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/used by/i);
  });

  it("refuses a missing version without touching anything", () => {
    expect(recipeRepo.deleteVersion("no-such-version").ok).toBe(false);
  });
});

describe("promoteVersion", () => {
  it("makes any version current and leaves pins untouched", () => {
    const { recipeId, v1, v2 } = twoVersionRecipe("Promote me");
    pinWithPlanEntry(v1);

    expect(recipeRepo.promoteVersion(recipeId, v1).ok).toBe(true);
    expect(recipeRepo.getRecipe(recipeId)?.summary.currentVersionId).toBe(v1);

    // the pin is exactly where it was; promoting must not rewrite it
    const plan = planRepo.getPlan("2030-05-04")!;
    const listed = planRepo.listPlanEntries(plan.id).filter((entry) => entry.recipeVersionId === v1);
    expect(listed.length).toBeGreaterThan(0);
    expect(recipeRepo.getRecipe(recipeId)?.summary.currentVersionId).toBe(v1);
    expect(recipeRepo.countVersionReferences(v1)).toBeGreaterThan(0);
    void v2;
  });

  it("refuses a version from another recipe", () => {
    const { recipeId, v1 } = twoVersionRecipe("Recipe A");
    const other = twoVersionRecipe("Recipe B");

    const result = recipeRepo.promoteVersion(other.recipeId, v1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/belong/i);
    expect(recipeId).not.toBe(other.recipeId);
  });

  it("refuses a missing version", () => {
    const { recipeId } = twoVersionRecipe("Promote ghost");
    expect(recipeRepo.promoteVersion(recipeId, "no-such-version").ok).toBe(false);
  });
});

describe("countVersionReferences", () => {
  it("counts plan and diary pins for one version only", () => {
    const { v1, v2 } = twoVersionRecipe("References");
    pinWithPlanEntry(v1);
    entries.addRecipeEntry({
      recipeVersionId: v1,
      servings: 1,
      grams: 150,
      amount: 1,
      unit: "serving",
      day: "2030-05-06",
    });

    expect(recipeRepo.countVersionReferences(v1)).toBe(2);
    expect(recipeRepo.countVersionReferences(v2)).toBe(0);
  });
});
