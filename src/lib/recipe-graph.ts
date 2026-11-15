/**
 * Recipe as a process graph (R1).
 *
 * A recipe is a directed acyclic graph of process nodes. Each node has inputs
 * (foods or outputs of earlier nodes), an operation, and one or more named
 * outputs. The graph is stored in `recipe_versions.process_graph` as JSON.
 *
 * This module is pure: no database, no React. It defines the types, the
 * transformation logic (`applyEffect`), and the migration from the legacy
 * linear block model.
 */

import { NUTRIENT_CODES, type NutrientCode, type NutrientProfile } from "@/lib/nutrition/types";
import { combine, rollup, type Rollup } from "@/lib/nutrition/engine";

export type ProcessOperation =
  | "none"
  | "cook"
  | "boil"
  | "steam"
  | "fry"
  | "roast"
  | "bake"
  | "blend"
  | "cool"
  | "freeze"
  | "marinate"
  | "ferment"
  | "reduce"
  | "strain"
  | "dry";

export interface ProcessEffect {
  operation: ProcessOperation;
  /** Per-nutrient retention factor. 1.0 = unchanged. Absent = unknown. */
  retention: Partial<Record<NutrientCode, number>>;
  /** Added nutrients, per 100 g of output. */
  added: Partial<Record<NutrientCode, number>>;
  /** Removed nutrients, per 100 g of output. */
  removed: Partial<Record<NutrientCode, number>>;
  source: "reference" | "estimated" | "none";
  rationale: string;
  confidence: number;
}

export interface ProcessInput {
  source:
    | { type: "food"; foodId: string }
    | { type: "node"; nodeId: string; outputIndex: number };
  grams: number;
  amount: number;
  unit: string;
  portionLabel?: string | null;
  preparation?: string | null;
  note?: string | null;
}

export interface ProcessOutput {
  name: string;
  grams: number | null;
}

export type ProcessNodeKind = "input" | "process" | "split" | "combine" | "output";

export interface ProcessNode {
  id: string;
  label: string;
  kind: ProcessNodeKind;
  inputs: ProcessInput[];
  operation: ProcessOperation;
  outputMassG: number | null;
  yieldBasis: "measured" | "estimated" | "none";
  outputs: ProcessOutput[];
  lane: number;
  dependsOn: string[];
}

export interface ProcessGraph {
  nodes: ProcessNode[];
  // Edges are derived from inputs, but stored for convenience.
  edges: { from: string; to: string; outputIndex: number }[];
}

export interface BlockChange {
  code: NutrientCode;
  before: number | null;
  after: number | null;
  delta: number | null;
  percent: number | null;
}

export interface BlockSnapshot {
  nodeId: string;
  label: string;
  operation: ProcessOperation;
  inputGrams: number;
  outputGrams: number | null;
  before: NutrientProfile;
  after: NutrientProfile;
  change: BlockChange[];
  effectSource: "reference" | "estimated" | "none";
  effectRationale: string;
  outputs: { name: string; grams: number | null; after: NutrientProfile }[];
}

/**
 * Apply a process effect to a "before" profile, producing an "after" profile.
 *
 * Retention scales the total; added/removed are per 100 g of output and
 * scale with output mass. Output mass does not change totals — it changes
 * per-100-g values, which are derived later.
 */
export function applyEffect(
  before: NutrientProfile,
  effect: ProcessEffect,
  outputMassG: number | null,
): NutrientProfile {
  const after = { ...before };
  const massFactor = outputMassG != null && outputMassG > 0 ? outputMassG / 100 : 1;

  for (const code of NUTRIENT_CODES) {
    let value = before[code].amount;
    const hasAdded = effect.added[code] != null;
    const hasRemoved = effect.removed[code] != null;
    if (value == null && !hasAdded && !hasRemoved) {
      after[code] = { ...before[code] };
      continue;
    }
    if (value == null) value = 0;

    // retention
    const r = effect.retention[code];
    if (r != null && Number.isFinite(r)) {
      value = value * r;
    }

    // added (per 100 g of output)
    const a = effect.added[code];
    if (a != null && Number.isFinite(a)) {
      value = value + a * massFactor;
    }

    // removed (per 100 g of output)
    const rem = effect.removed[code];
    if (rem != null && Number.isFinite(rem)) {
      value = value - rem * massFactor;
    }

    if (value < 0) value = 0;

    after[code] = {
      ...before[code],
      amount: value,
      status: (hasAdded || hasRemoved) ? "estimated" : before[code].status,
      source: before[code].source,
    };
  }

  return after;
}

/**
 * Compute the change array between before and after profiles.
 */
export function computeChange(
  before: NutrientProfile,
  after: NutrientProfile,
): BlockChange[] {
  return NUTRIENT_CODES.map((code) => {
    const b = before[code].amount;
    const a = after[code].amount;
    let delta: number | null = null;
    let percent: number | null = null;
    if (b != null && a != null) {
      delta = a - b;
      if (b !== 0) percent = (delta / b) * 100;
    }
    return { code, before: b, after: a, delta, percent };
  });
}

/**
 * A "no-op" effect: retention 1.0 for everything, nothing added/removed.
 * Used for blend/mix operations and for migrated legacy blocks.
 */
export function noOpEffect(operation: ProcessOperation = "none"): ProcessEffect {
  const retention: ProcessEffect["retention"] = {};
  for (const code of NUTRIENT_CODES) retention[code] = 1;
  return {
    operation,
    retention,
    added: {},
    removed: {},
    source: "none",
    rationale: "No nutrient change assumed for this operation.",
    confidence: 1,
  };
}

/**
 * Migrate a legacy linear block (the old model) into a process node.
 * The operation is "none" (inert) unless the legacy block had a yield,
 * in which case we keep yieldBasis but still mark the effect as "none".
 */
export function legacyBlockToNode(
  legacy: {
    id?: string;
    name?: string;
    operation?: string | null;
    outputGrams?: number | null;
    inputs: { foodId: string; grams: number; amount: number; unit: string; portionLabel?: string | null; preparation?: string | null; note?: string | null }[];
  },
  index: number,
): ProcessNode {
  const id = legacy.id ?? `b${index + 1}`;
  const inputs: ProcessInput[] = legacy.inputs.map((inp) => ({
    source: { type: "food", foodId: inp.foodId },
    grams: inp.grams,
    amount: inp.amount,
    unit: inp.unit,
    portionLabel: inp.portionLabel ?? null,
    preparation: inp.preparation ?? null,
    note: inp.note ?? null,
  }));

  const outputMassG = legacy.outputGrams ?? null;
  const node: ProcessNode = {
    id,
    label: legacy.name?.trim() || `Block ${index + 1}`,
    kind: "process",
    inputs,
    operation: (legacy.operation as ProcessOperation) ?? "none",
    outputMassG,
    yieldBasis: outputMassG != null ? "measured" : "none",
    outputs: [{ name: legacy.name?.trim() || `Block ${index + 1}`, grams: outputMassG }],
    lane: 0,
    dependsOn: [],
  };
  return node;
}

/**
 * Build a straight-line graph from legacy blocks (migration).
 */
export function legacyBlocksToGraph(
  legacies: Parameters<typeof legacyBlockToNode>[0][],
): ProcessGraph {
  const nodes = legacies.map((legacy, i) => legacyBlockToNode(legacy, i));
  // Wire sequential dependencies: node i depends on node i-1.
  for (let i = 1; i < nodes.length; i++) {
    nodes[i].dependsOn = [nodes[i - 1].id];
    // If a node has no explicit food inputs, assume it consumes the previous
    // node's first output.
    if (nodes[i].inputs.length === 0) {
      nodes[i].inputs = [
        { source: { type: "node", nodeId: nodes[i - 1].id, outputIndex: 0 }, grams: nodes[i - 1].outputMassG ?? 0, amount: nodes[i - 1].outputMassG ?? 0, unit: "g" },
      ];
    }
  }
  const edges = nodes.slice(1).map((n, i) => ({
    from: nodes[i].id,
    to: n.id,
    outputIndex: 0,
  }));
  return { nodes, edges };
}

/**
 * Topological sort of a graph (Kahn's algorithm). Returns node ids in
 * execution order. Throws if the graph has a cycle.
 */
export function topoSort(graph: ProcessGraph): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adj.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  // Also count implicit dependencies from inputs.
  for (const node of graph.nodes) {
    for (const input of node.inputs) {
      if (input.source.type === "node") {
        const from = input.source.nodeId;
        if (!adj.get(from)?.includes(node.id)) {
          adj.get(from)?.push(node.id);
          inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
        }
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (result.length !== graph.nodes.length) {
    throw new Error("Process graph has a cycle.");
  }
  return result;
}

/**
 * Validate a graph: unique ids, no cycles, inputs reference valid nodes/foods.
 */
export function validateGraph(
  graph: ProcessGraph,
  knownFoodIds: Set<string>,
): { ok: boolean; message?: string } {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id) return { ok: false, message: "A node is missing an id." };
    if (ids.has(node.id)) return { ok: false, message: `Duplicate node id: ${node.id}.` };
    ids.add(node.id);
    if (!node.label) return { ok: false, message: `Node ${node.id} needs a label.` };
    if (node.outputs.length === 0) return { ok: false, message: `Node ${node.id} needs at least one output.` };
  }
  try {
    topoSort(graph);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  for (const node of graph.nodes) {
    for (const input of node.inputs) {
      if (input.source.type === "food") {
        if (!knownFoodIds.has(input.source.foodId)) {
          return { ok: false, message: `Node ${node.id} references unknown food ${input.source.foodId}.` };
        }
      } else {
        const nodeId = input.source.type === "node" ? input.source.nodeId : null;
        const target = nodeId ? graph.nodes.find((n) => n.id === nodeId) : null;
        if (!target) return { ok: false, message: `Node ${node.id} references unknown node ${input.source.nodeId}.` };
        if (target && input.source.type === "node" && input.source.outputIndex >= target.outputs.length) {
          return { ok: false, message: `Node ${node.id} references output ${input.source.outputIndex} of ${target.id}, which has ${target.outputs.length} output(s).` };
        }
      }
      if (!(input.grams > 0)) return { ok: false, message: `Node ${node.id} has a non-positive input weight.` };
    }
    if (node.outputMassG != null && !(node.outputMassG > 0)) {
      return { ok: false, message: `Node ${node.id} has a non-positive output mass.` };
    }
  }
  return { ok: true };
}
