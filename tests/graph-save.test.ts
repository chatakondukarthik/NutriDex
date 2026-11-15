import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let dir: string;
let saveGraphDraft: typeof import("@/lib/recipes-v2")["saveGraphDraft"];
let recipes: typeof import("@/lib/db/recipes");
let db: typeof import("@/lib/db/client")["db"];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-graphsave-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  const mod = await import("@/lib/recipes-v2");
  saveGraphDraft = mod.saveGraphDraft;
  recipes = await import("@/lib/db/recipes");
  db = (await import("@/lib/db/client")).db;
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec("DELETE FROM plan_entries; DELETE FROM component_inputs; DELETE FROM components; DELETE FROM recipe_versions; DELETE FROM recipes;");
});

describe("saveGraphDraft", () => {
  it("saves a simple food→process graph as a v2 version", () => {
    const result = saveGraphDraft({
      recipeId: null,
      name: "Paneer curry",
      instructions: "Cook it.",
      servings: 2,
      graph: {
        nodes: [
          { id: "f1", type: "food", foodId: "paneer", grams: 50 },
          { id: "p1", type: "process", operation: "fry", name: "Fry paneer", outputs: [{ label: "Fried paneer", tag: "consumed", split: {} }] },
        ],
        edges: [{ id: "e1", from: "f1", to: "p1" }],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.recipeId).toBeTruthy();

    const saved = recipes.getRecipe(result.recipeId!);
    expect(saved?.summary.name).toBe("Paneer curry");
    expect(saved?.versions[0].kcalPerServing).toBeGreaterThan(0);
  });

  it("rejects a graph with a cycle", () => {
    const result = saveGraphDraft({
      recipeId: null,
      name: "Broken",
      instructions: "",
      servings: 1,
      graph: {
        nodes: [
          { id: "a", type: "process", operation: "mix", name: "A", outputs: [{ label: "a", tag: "consumed", split: {} }] },
          { id: "b", type: "process", operation: "mix", name: "B", outputs: [{ label: "b", tag: "consumed", split: {} }] },
        ],
        edges: [
          { id: "ab", from: "a", to: "b" },
          { id: "ba", from: "b", to: "a" },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/cycle/i);
  });

  it("rejects an unknown food id", () => {
    const result = saveGraphDraft({
      recipeId: null,
      name: "Bad food",
      instructions: "",
      servings: 1,
      graph: {
        nodes: [{ id: "f", type: "food", foodId: "not-a-food", grams: 100 }],
        edges: [],
      },
    });
    expect(result.ok).toBe(false);
  });

  it("hung curd keeps whey out of the dish total", () => {
    const result = saveGraphDraft({
      recipeId: null,
      name: "Hung curd",
      instructions: "",
      servings: 1,
      graph: {
        nodes: [
          { id: "curd", type: "food", foodId: "curd", grams: 100 },
          {
            id: "hang",
            type: "process",
            operation: "strain",
            name: "Hang curd",
            measuredOutputs: [70, 30],
            outputs: [
              { label: "Hung curd", tag: "consumed", split: { FAT: 0.98, PROCNT: 0.8, CHOCDF: 0.35, NA: 0.55, VITB12: 0.6, ENERC_KCAL: 0.6 } },
              { label: "Whey", tag: "discarded", split: { FAT: 0.02, PROCNT: 0.2, CHOCDF: 0.65, NA: 0.45, VITB12: 0.4, ENERC_KCAL: 0.4 } },
            ],
          },
        ],
        edges: [{ id: "e", from: "curd", to: "hang" }],
      },
    });
    expect(result.ok).toBe(true);
    const saved = recipes.getRecipe(result.recipeId!);
    expect(saved).toBeTruthy();
  });
});
