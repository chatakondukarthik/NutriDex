import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NUTRIPLAN_DB_PATH = "/tmp/nutriplan-plan-notes-test.sqlite";
});

import type { RecipePlan } from "@/lib/ai-generate-recipe";

/**
 * The planner writes optional notes onto every step and ingredient, the
 * materializer bounds them, arranges the canvas, and carries a hand-written
 * note forward when the model does not restate it.
 *
 * Seed-food names are used so resolvePlanFoods matches locally and never
 * touches the USDA network.
 */

const BASE: RecipePlan = {
  name: "Notes test",
  servings: 2,
  instructions: "",
  steps: [],
};

interface SavedGraph {
  nodes: Array<{
    id: string;
    type: string;
    note?: string | null;
  }>;
  edges: Array<{ from: string; to: string }>;
}

async function materialize(plan: RecipePlan, recipeId?: string) {
  const { materializeRecipe } = await import("@/lib/ai-generate-recipe");
  const { getRecipe, getVersion } = await import("@/lib/db/recipes");
  const saved = await materializeRecipe(plan, recipeId);
  const recipe = getRecipe(saved.recipeId);
  expect(recipe).toBeTruthy();
  const versionId = recipe!.summary.currentVersionId;
  expect(versionId).toBeTruthy();
  const version = getVersion(versionId!);
  expect(version).toBeTruthy();
  const snapshot = version!.snapshot as unknown as {
    graph?: SavedGraph;
    layout?: Record<string, { x: number; y: number }>;
  };
  expect(snapshot.graph).toBeTruthy();
  return { recipeId: saved.recipeId, graph: snapshot.graph!, layout: snapshot.layout ?? {} };
}

const notedPlan: RecipePlan = {
  ...BASE,
  steps: [
    {
      name: "Marinate",
      operation: "marinate",
      inputs: [{ foodName: "Paneer", grams: 100, note: "pat dry first" }],
      consumes: [],
      note: "At least 30 minutes so the salt travels in.",
    },
    {
      name: "Fry",
      operation: "fry",
      inputs: [],
      consumes: [0],
      note: "Hot oil — it should sizzle the moment the paneer lands.",
    },
  ],
};

const barePlan: RecipePlan = {
  ...BASE,
  steps: notedPlan.steps.map((step) => ({
    ...step,
    note: undefined,
    inputs: step.inputs.map((input) => ({ ...input, note: undefined })),
  })),
};

function nodeOfType(graph: SavedGraph, type: string) {
  return graph.nodes.filter((n) => n.type === type);
}

describe("materializeRecipe notes", () => {
  it("writes the model's notes onto every block", async () => {
    const { graph } = await materialize(notedPlan);
    const process = nodeOfType(graph, "process");
    expect(process[0].note).toBe("At least 30 minutes so the salt travels in.");
    expect(process[1].note).toBe("Hot oil — it should sizzle the moment the paneer lands.");
    const food = nodeOfType(graph, "food");
    expect(food[0].note).toBe("pat dry first");
  });

  it("bounds a runaway note at 1000 characters", async () => {
    const plan: RecipePlan = {
      ...BASE,
      steps: [
        {
          name: "Mix",
          operation: "mix",
          inputs: [{ foodName: "Paneer", grams: 50 }],
          consumes: [],
          note: "z".repeat(1500),
        },
      ],
    };
    const { graph } = await materialize(plan);
    expect(graph.nodes.find((n) => n.type === "process")!.note).toHaveLength(1000);
  });

  it("arranges the canvas instead of the naive two-column layout", async () => {
    const { graph, layout } = await materialize(notedPlan);
    expect(Object.keys(layout)).toHaveLength(graph.nodes.length);
    const food = graph.nodes.find((n) => n.type === "food")!;
    const firstStep = graph.nodes.find((n) => n.type === "process")!;
    expect(layout[food.id].x).toBeLessThan(layout[firstStep.id].x);
  });

  it("carries a hand-written note forward when the model omits it", async () => {
    const first = await materialize(notedPlan);
    const second = await materialize(barePlan, first.recipeId);
    const processes = second.graph.nodes.filter((n) => n.type === "process");
    expect(processes[0].note).toBe("At least 30 minutes so the salt travels in.");
    expect(processes[1].note).toBe("Hot oil — it should sizzle the moment the paneer lands.");
    expect(second.graph.nodes.find((n) => n.type === "food")!.note).toBe("pat dry first");
  });

  it("lets a model-provided note win over the preserved one", async () => {
    const first = await materialize(notedPlan);
    const replacement: RecipePlan = {
      ...BASE,
      steps: [
        {
          name: "Marinate",
          operation: "marinate",
          inputs: [{ foodName: "Paneer", grams: 100 }],
          consumes: [],
          note: "Overnight, covered, in the fridge.",
        },
      ],
    };
    const second = await materialize(replacement, first.recipeId);
    const process = second.graph.nodes.find((n) => n.type === "process")!;
    expect(process.note).toBe("Overnight, covered, in the fridge.");
  });
});
