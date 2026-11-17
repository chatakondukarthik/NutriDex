/**
 * Save path for graph (v2) recipes.
 *
 * The display contract (RecipeResult) is kept so the detail page, the plan
 * board and the diary all keep working unchanged. The graph itself and the
 * canvas layout are stored alongside it inside the same snapshot JSON so a
 * v2 version is fully self-describing.
 */

import { addVersion, createRecipe, replaceVersion, getVersionOwner } from "@/lib/db/recipes";
import { computeRecipeGraph } from "@/lib/nutrition/graph-server";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";
import { combine, perServing, scaleRollup, type Rollup } from "@/lib/nutrition/engine";
import { cleanNote } from "@/lib/notes";
import type { RecipeResult, BlockResult, YieldBasis } from "@/lib/nutrition/recipe";
import type { Graph, GraphProcessNode, GraphNode } from "@/lib/nutrition/graph";

export interface GraphDraft {
  recipeId: string | null;
  name: string;
  versionLabel?: string | null;
  instructions: string;
  servings: string | number;
  layout?: Record<string, { x: number; y: number }>;
  graph: Graph;
  /** Default appends a new version. "replace-current" rewrites replaceVersionId in place. */
  mode?: "new-version" | "replace-current";
  /** The version row to rewrite when mode is "replace-current". */
  replaceVersionId?: string | null;
}

export interface SaveGraphResult {
  ok: boolean;
  recipeId?: string;
  versionId?: string;
  versionNo?: number;
  message?: string;
}

export type GraphSnapshot = RecipeResult & {
  graph: Graph;
  layout?: Record<string, { x: number; y: number }>;
  perNode?: Record<string, unknown>;
};

function scaledProfileClone(result: Rollup, factor: number): Rollup {
  return scaleRollup(result, factor);
}

export function saveGraphDraft(draft: GraphDraft): SaveGraphResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, message: "Give the recipe a name." };

  const servings = Number(draft.servings);
  if (!Number.isFinite(servings) || servings <= 0) {
    return { ok: false, message: "Servings must be a positive number." };
  }

  // Notes are trimmed and capped once, here, so every writer (editor, AI,
  // fragments, direct saves) ends up with the same bounded shape.
  const graph = normalizeGraphNotes(draft.graph);

  let result: ReturnType<typeof computeRecipeGraph>;
  try {
    result = computeRecipeGraph(graph);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The recipe graph could not be computed.",
    };
  }

  const consumed = result.consumed;
  const inputGrams = result.inputGrams;
  const yieldBasis: YieldBasis = result.yieldBasis === "measured" ? "measured" : "none";

  // v1-compatible blocks in topological order for the detail page
  const graphById = new Map(graph.nodes.map((n) => [n.id, n]));
  const blocks: BlockResult[] = [...result.perNode.entries()].map(([id, node]) => ({
    name: node.name,
    operation: node.operation,
    inputGrams: node.inputGrams,
    outputGrams: node.masses[0] ?? null,
    result: combine(node.after),
    note: (graphById.get(id) as GraphProcessNode | undefined)?.note ?? null,
  }));

  const perNode: Record<string, unknown> = {};
  for (const [id, node] of result.perNode) {
    perNode[id] = {
      name: node.name,
      operation: node.operation,
      qualifier: node.qualifier,
      factors: node.factors,
      unknownNutrients: node.unknownNutrients,
      before: node.before,
      after: node.after,
      masses: node.masses,
      inputGrams: node.inputGrams,
      inputEdges: node.inputEdges,
    };
  }

  const snapshot: GraphSnapshot = {
    blocks,
    total: consumed,
    perServing: perServing(consumed, servings),
    per100g: result.consumedGrams > 0 ? scaledProfileClone(consumed, 100 / result.consumedGrams) : null,
    servings,
    inputGrams,
    outputGrams: result.consumedGrams,
    yieldBasis,
    calculationVersion: "2",
    graph,
    layout: draft.layout,
    perNode,
  };

  // components table blocks need inputs; build them from the graph
  const components = buildComponentsFromGraph(graph, result);

  const version = {
    instructions: draft.instructions,
    servings,
    yieldGrams: result.consumedGrams > 0 ? result.consumedGrams : null,
    snapshot,
    blocks: components.map((component) => ({
      name: component.name,
      operation: component.operation,
      outputGrams: component.outputGrams,
      inputs: component.inputs.map((input) => ({
        foodId: input.foodId,
        grams: input.grams,
        amount: input.grams,
        unit: "g",
        preparation: "raw",
        note: input.note ?? null,
      })),
    })),
    label: draft.versionLabel?.trim() || null,
  };

  try {
    if (draft.mode === "replace-current") {
      // Without `recipeId` the ownership check below never ran, so any
      // caller could rewrite any recipe's version in place by naming its
      // id — defeating the immutability that plans and the diary pin to.
      if (!draft.replaceVersionId) {
        return { ok: false, message: "Choose which version to replace." };
      }
      if (!draft.recipeId) {
        return { ok: false, message: "Open the recipe you want to replace a version in." };
      }
      const owner = getVersionOwner(draft.replaceVersionId);
      if (owner !== draft.recipeId) {
        return { ok: false, message: "That version does not belong to this recipe." };
      }
      const replaced = replaceVersion(draft.replaceVersionId, version);
      if (!replaced.ok) return { ok: false, message: replaced.message };
      return {
        ok: true,
        recipeId: replaced.recipeId,
        versionId: replaced.versionId,
        versionNo: replaced.versionNo,
      };
    }
    const saved = draft.recipeId
      ? addVersion(draft.recipeId, version, name)
      : createRecipe({ name }, version);
    return { ok: true, ...saved };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The recipe could not be saved.",
    };
  }
}

function buildComponentsFromGraph(
  graph: Graph,
  result: ReturnType<typeof computeRecipeGraph>,
) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const components: Array<{
    name: string;
    operation: string | null;
    outputGrams: number | null;
    inputs: Array<{ foodId: string; grams: number; note?: string | null }>;
  }> = [];

  for (const [id, node] of result.perNode) {
    const graphNode = byId.get(id)! as GraphProcessNode;
    const inputs: Array<{ foodId: string; grams: number; note?: string | null }> = [];
    for (const edge of graph.edges) {
      if (edge.to !== id) continue;
      const from = byId.get(edge.from);
      if (from?.type === "food") {
        // The ingredient's own note travels to component_inputs, which the
        // recipe detail page already renders.
        inputs.push({ foodId: from.foodId, grams: from.grams, note: from.note ?? null });
      }
    }
    components.push({
      name: node.name,
      operation: node.operation,
      outputGrams: node.masses[0] ?? null,
      inputs,
    });
  }
  return components;
}

/** Trim, cap and normalise every node's note before it reaches storage. */
function normalizeGraphNotes(graph: Graph): Graph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, note: cleanNote((node as { note?: unknown }).note) ?? null })),
    edges: graph.edges,
  };
}

export function perServingENERC(snapshot: GraphSnapshot): number | null {
  return snapshot.perServing.totals.ENERC_KCAL;
}
