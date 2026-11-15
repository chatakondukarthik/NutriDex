/**
 * Build a recipe graph from a free-text prompt. Two phases so the user
 * always sees what will be created before anything is saved:
 *
 *   planRecipeFromPrompt(prompt) -> RecipePlan   (LLM, read-only)
 *   materializeRecipe(plan, note?) -> recipeId   (creates foods, writes graph)
 *
 * The model proposes the *structure*; nothing here trusts a number it cannot
 * back. Unknown foods are created as provisional (all-unknown nutrition) and
 * are fully editable afterwards.
 */

import { complete } from "@/lib/ai/client";
import { getAiConfig } from "@/lib/ai/client";
import { hasKey } from "@/lib/ai/secrets";
import { isAiEnabled } from "@/lib/ai/client";
import { listFoods } from "@/lib/db/foods";
import { resolvePlanFoods } from "@/lib/ai/food-resolve";
import { saveGraphDraft } from "@/lib/recipes-v2";
import type { Graph } from "@/lib/nutrition/graph";

export interface RecipePlanStepInput {
  foodName: string;
  grams: number;
  preparation?: string;
}

export interface RecipePlanStep {
  name: string;
  operation: string;
  inputs: RecipePlanStepInput[];
}

export interface RecipePlan {
  name: string;
  servings: number;
  instructions: string;
  steps: RecipePlanStep[];
}

export interface ExistingRecipeContext {
  name: string;
  servings: number;
  instructions: string;
  /** Plain-JSON copy of the current graph (nodes + edges). */
  graph: unknown;
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    servings: { type: "number" },
    instructions: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Imperative step name, e.g. 'Sauté aromatics'" },
          operation: {
            type: "string",
            enum: [
              "assemble", "mix", "boil", "pressure-cook", "steam", "sauté", "fry",
              "deep-fry", "roast", "bake", "grill", "blend", "strain", "reduce",
              "cool", "refrigerate", "freeze", "marinate", "ferment", "wash", "soak",
              "grate", "dice", "slice", "chop",
            ],
          },
          inputs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                foodName: { type: "string" },
                grams: { type: "number" },
                preparation: { type: "string" },
              },
              required: ["foodName", "grams"],
            },
          },
        },
        required: ["name", "operation", "inputs"],
      },
    },
  },
  required: ["name", "servings", "steps"],
} as const;

const SYSTEM = `You are a recipe architect for Indian home cooking.
Return ONLY a JSON object matching the schema. Rules:
- Decompose the dish into sequential steps (3–7 steps for most dishes).
- Each step takes the quantities of its inputs in grams.
- Only include food inputs needed for that step — do not repeat upstream steps' inputs in later steps unless they are used again.
- Chain steps: each step's output feeds the next step's inputs implicitly; later steps only list NEW ingredients.
- If the prompt is vague, keep quantities modest (serves ~2) and say so in instructions.
- Never invent nutrient values; you are not asked for them.
- Use common Indian ingredient names.`;

export async function planRecipeFromPrompt(
  prompt: string,
  existing?: ExistingRecipeContext,
): Promise<RecipePlan> {
  if (!prompt.trim()) throw new Error("Ask me something first — a dish, a mood, a fridge list.");

  const config = getAiConfig();
  if (!isAiEnabled()) throw new Error("AI is turned off in Settings.");
  if (!hasKey(config.provider)) throw new Error("No AI key configured. Add one in Settings.");

  const existingSection = existing
    ? `\nExisting recipe (modify this, do not start over):\nName: ${existing.name}\nServings: ${existing.servings}\nInstructions: ${existing.instructions}\nGraph (nodes and edges):\n${JSON.stringify(existing.graph)}\nApply the user's request to this recipe.`
    : "";

  const response = await complete({
    capability: "text",
    system: SYSTEM,
    prompt: `${prompt}${existingSection}`,
    jsonSchema: PLAN_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
    maxTokens: 2048,
  });

  const raw = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(raw) as RecipePlan;
  if (!parsed?.steps?.length) throw new Error("The model did not produce any steps.");
  return parsed;
}

export async function materializeRecipe(
  plan: RecipePlan,
  recipeId?: string,
  opts?: { mode?: "new-version" | "replace-current"; replaceVersionId?: string | null },
): Promise<{ recipeId: string; resolutions: import("@/lib/ai/food-resolve").PlanFoodResolution[] }> {
  const { map: foodIndex, resolutions } = await resolvePlanFoods(plan, listFoods(), { persist: true });
  const idBase = `gen-${Date.now().toString(36)}`;
  const nodes: Graph["nodes"] = [];
  const edges: Graph["edges"] = [];

  let prevProcessId: string | null = null;
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const processId = `${idBase}-p${i}`;
    nodes.push({
      id: processId,
      type: "process",
      operation: step.operation,
      name: step.name,
      outputs: [{ label: step.name, tag: "consumed", split: {} }],
      measuredOutputs: [null],
      factorEstimates: {},
      factorOverrides: {},
    });

    for (const input of step.inputs) {
      const foodId = foodIndex.get(input.foodName.trim().toLowerCase());
      if (!foodId) continue;
      const inputNodeId = `${idBase}-i${i}-${foodId.slice(0, 8)}`;
      nodes.push({
        id: inputNodeId,
        type: "food",
        foodId,
        grams: Math.max(1, input.grams),
      });
      edges.push({
        id: `${inputNodeId}-${processId}`,
        from: inputNodeId,
        to: processId,
      });
    }

    if (prevProcessId) {
      edges.push({ id: `${prevProcessId}-${processId}`, from: prevProcessId, to: processId });
    }
    prevProcessId = processId;
  }

  // Layouts: ingredients on the left, processes in a column on the right
  const layout: Record<string, { x: number; y: number }> = {};
  let foodY = 0;
  let processY = 0;
  for (const node of nodes) {
    if (node.type === "food") {
      layout[node.id] = { x: 0, y: foodY };
      foodY += 140;
    } else {
      layout[node.id] = { x: 340, y: processY };
      processY += 170;
    }
  }

  const saved = saveGraphDraft({
    recipeId: recipeId ?? null,
    name: plan.name,
    instructions: plan.instructions,
    servings: plan.servings,
    versionLabel: "AI",
    layout,
    graph: { nodes, edges },
    mode: opts?.mode,
    replaceVersionId: opts?.replaceVersionId ?? null,
  });

  if (!saved.ok || !saved.recipeId) {
    throw new Error(saved.message ?? "Could not save the generated recipe.");
  }
  return { recipeId: saved.recipeId, resolutions };
}
