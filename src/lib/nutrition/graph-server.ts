/**
 * Database-aware helpers around the pure graph engine (server only).
 */

import { db } from "@/lib/db/client";
import { getFood } from "@/lib/db/foods";
import {
  computeGraph,
  type FactorTable,
  type Graph,
  type GraphNode,
  type GraphProcessNode,
  type ComputedProcessNode,
} from "./graph";
import { NUTRIENT_CODES, type NutrientCode } from "./types";
import { inputGrams } from "@/lib/recipe-draft";
import type { BuilderBlock, BuilderInput } from "@/lib/recipe-draft";

/** Load the retention table into the engine's lookup shape. */
export function buildFactorTable(): FactorTable {
  const rows = db
    .prepare(`SELECT operation, qualifier, nutrient, factor, source FROM retention_factors`)
    .all() as unknown as Array<{
    operation: string;
    qualifier: string | null;
    nutrient: string;
    factor: number;
    source: string;
  }>;

  const lookup = new Map<
    string,
    Map<string | null, Map<NutrientCode, { factor: number; source: string }>>
  >();
  for (const row of rows) {
    let byQualifier = lookup.get(row.operation);
    if (!byQualifier) lookup.set(row.operation, (byQualifier = new Map()));
    let byNutrient = byQualifier.get(row.qualifier);
    if (!byNutrient) byQualifier.set(row.qualifier, (byNutrient = new Map()));
    byNutrient.set(row.nutrient as NutrientCode, { factor: row.factor, source: row.source });
  }
  return { lookup };
}

/** Resolve a food's per-100 g profile for the engine. */
export function resolveProfile(foodId: string) {
  const food = getFood(foodId);
  if (!food) throw new Error(`Unknown food: ${foodId}`);
  return food.nutrients;
}

export function computeRecipeGraph(graph: Graph) {
  return computeGraph(graph, resolveProfile, { factorTable: buildFactorTable() });
}

/**
 * Convert a legacy v1 draft (ordered blocks) into a v2 graph.
 * Each block becomes one process node; block output masses carry over as
 * measured outputs. Operation names come from the block operation. All
 * blocks are linear: out of one into the next.
 */
export function graphFromBlocks(
  blocks: BuilderBlock[],
  foods: Map<string, ReturnType<typeof getFood>>,
  prefix = "n",
): Graph {
  const nodes: GraphNode[] = [];
  const edges: Graph["edges"] = [];

  let previousProcess: string | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const processId = `${prefix}${i + 1}`;
    const process: GraphProcessNode = {
      id: processId,
      type: "process",
      operation: (block.operation ?? "assemble").trim() || "assemble",
      name: block.name?.trim() || `Step ${i + 1}`,
      measuredOutputs: (() => {
        const grams = Number(block.outputGrams);
        return [Number.isFinite(grams) && grams > 0 ? grams : null];
      })(),
      outputs: [{ label: block.name?.trim() || `Step ${i + 1} output`, tag: "consumed", split: {} }],
    };
    nodes.push(process);

    for (const input of block.inputs) {
      const foodId = input.foodId;
      if (!foodId) continue;
      const food = foods.get(foodId);
      if (!food) throw new Error(`Unknown food: ${foodId}`);
      const converted = inputGrams(food, input);
      if (!converted.ok) throw new Error(converted.reason);
      const foodNodeId = `${prefix}${i + 1}-f${nodes.length}`;
      nodes.push({ id: foodNodeId, type: "food", foodId, grams: converted.grams });
      edges.push({ id: `${processId}-${foodNodeId}`, from: foodNodeId, to: processId });
    }

    if (previousProcess) {
      edges.push({ id: `${previousProcess}-${processId}`, from: previousProcess, to: processId });
    }
    previousProcess = processId;
  }
  return { nodes, edges };
}

/** Summarise a computed graph for the snapshot (test-friendly shape). */
export function summariseGraph(result: ReturnType<typeof computeGraph>) {
  const perNode: Record<string, unknown> = {};
  for (const [id, node] of result.perNode) {
    perNode[id] = {
      name: node.name,
      operation: node.operation,
      qualifier: node.qualifier,
      factors: node.factors,
      unknownNutrients: node.unknownNutrients,
      masses: node.masses,
      before: node.before,
      after: node.after,
    };
  }
  return perNode;
}
