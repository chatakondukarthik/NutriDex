import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NUTRIPLAN_DB_PATH = "/tmp/nutriplan-plan-edges-test.sqlite";
});

import type { RecipePlan } from "@/lib/ai-generate-recipe";

/**
 * The planner now declares real dependencies (`consumes`) instead of a
 * fake straight chain. materializeRecipe must translate those into edges,
 * ignore impossible (forward/self) indices, and keep the legacy chain for
 * plans that predate the field.
 *
 * Seed-food names are used throughout so resolvePlanFoods matches locally
 * and never touches the USDA network.
 */

const BASE: RecipePlan = {
  name: "Test",
  servings: 2,
  instructions: "",
  steps: [],
};

function stepsOf(consumes: Array<number[] | undefined>): RecipePlan {
  return {
    ...BASE,
    steps: consumes.map((deps, i) => ({
      name: `Step ${i + 1}`,
      operation: "mix",
      inputs: [{ foodName: "Paneer", grams: 100 }],
      ...(deps ? { consumes: deps } : {}),
    })),
  };
}

async function processEdges(plan: RecipePlan) {
  const { materializeRecipe } = await import("@/lib/ai-generate-recipe");
  const { getRecipe } = await import("@/lib/db/recipes");
  const saved = await materializeRecipe(plan);
  expect(saved.recipeId).toBeTruthy();
  const recipe = getRecipe(saved.recipeId);
  expect(recipe).toBeTruthy();
  if (!recipe?.summary.currentVersionId) return [];
  const { getVersion } = await import("@/lib/db/recipes");
  const version = getVersion(recipe.summary.currentVersionId);
  expect(version).toBeTruthy();
  if (!version) return [];
  const graph = (version.snapshot as { graph?: { nodes: unknown[]; edges: Array<{ from: string; to: string }> } }).graph!;
  expect(graph).toBeTruthy();
  if (!graph) return [];
  // Only process→process edges; food edges are covered elsewhere.
  const procIds = new Set(
    graph.nodes.filter((n) => (n as { type: string }).type === "process").map((n) => (n as { id: string }).id),
  );
  const index = new Map([...procIds].map((id, i) => [id, i]));
  return graph.edges
    .filter((e) => procIds.has(e.from) && procIds.has(e.to))
    .map((e) => [index.get(e.from)!, index.get(e.to)!] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe("materializeRecipe process edges", () => {
  it("wires only the declared consumes relationships", async () => {
    const plan = stepsOf([[ ], [0], [0, 1], []]);
    const edges = await processEdges(plan);
    expect(edges).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it("ignores forward, self and invalid indices (acyclic by construction)", async () => {
    const plan = stepsOf([[ ], [0, 2, 2, -1, 1.5, 99]]);
    const edges = await processEdges(plan);
    expect(edges).toEqual([[0, 1]]);
  });

  it("keeps the legacy straight chain when consumes is absent", async () => {
    const plan = stepsOf([undefined, undefined, undefined]);
    const edges = await processEdges(plan);
    expect(edges).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("allows independent parallel steps (no edge)", async () => {
    const plan = stepsOf([[ ], [ ], [0, 1]]);
    const edges = await processEdges(plan);
    expect(edges).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });
});
