/**
 * Recipe computation as a directed acyclic graph (D-040, D-041, D-044).
 *
 * A recipe is a DAG of nodes:
 *   - `food`     — a library food, loaded at full profile, scaled to its grams
 *   - `process`  — an operation with n incoming edges and 1..m outputs
 *
 * Each process applies, in order:
 *   1. retention — per-nutrient factor: node override > (table) > LLM estimate
 *      > none. The DB-aware caller passes the table; this module stays pure.
 *   2. yield — measured output mass wins; otherwise 1.0 and disclosed;
 *   3. split — multi-output nodes partition each nutrient across outputs.
 *
 * Absolute nutrient amounts never change because of mass loss (D-022
 * corrected): boiling concentrates per-100 g values but does not create or
 * destroy protein. Only retention factors change grams of nutrients.
 */

import { combine, rollup, type Rollup } from "./engine";
import { NUTRIENT_CODES, type NutrientCode, type NutrientProfile } from "./types";

export type OutputTag = "consumed" | "discarded";

export interface GraphFoodNode {
  id: string;
  type: "food";
  foodId: string;
  grams: number;
}

export interface GraphOutput {
  label: string;
  tag: OutputTag;
  /** Fraction of each nutrient going to this output, per nutrient. */
  split: Partial<Record<NutrientCode, number>>;
}

export interface GraphProcessNode {
  id: string;
  type: "process";
  operation: string;
  qualifier?: string | null;
  name: string;
  /** Measured mass per output, index-aligned. */
  measuredOutputs?: (number | null)[];
  /** User-entered factor overrides per nutrient. */
  factorOverrides?: Partial<Record<NutrientCode, number>>;
  /** LLM-estimated factors per nutrient. */
  factorEstimates?: Partial<Record<NutrientCode, number>>;
  outputs: GraphOutput[];
}

export type GraphNode = GraphFoodNode | GraphProcessNode;

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FactorTable {
  /** operation -> qualifier -> nutrient -> { factor, source } */
  lookup: Map<string, Map<string | null, Map<NutrientCode, { factor: number; source: string }>>>;
}

export interface AppliedFactor {
  nutrient: NutrientCode;
  factor: number;
  source: "override" | "table" | "estimated";
}

export interface ComputedProcessNode {
  id: string;
  name: string;
  operation: string;
  qualifier: string | null;
  before: Rollup;
  /** one per output, index-aligned */
  after: Rollup[];
  factors: AppliedFactor[];
  unknownNutrients: NutrientCode[];
  /** mass per output, index-aligned */
  masses: number[];
  /** total mass of the inputs (food + upstream) */
  inputGrams: number;
  /** input node ids with their grams */
  inputEdges: { from: string; grams: number }[];
}

export interface GraphResult {
  perNode: Map<string, ComputedProcessNode>;
  consumed: Rollup;
  consumedGrams: number;
  discarded: Rollup;
  discardedGrams: number;
  inputGrams: number;
  yieldBasis: "measured" | "partial" | "none";
}

export interface ComputeOptions {
  /** Per 100 g table lookup. May be empty — the engine stays honest without it. */
  factorTable?: FactorTable;
}

function tableLookup(
  table: FactorTable | undefined,
  operation: string,
  qualifier: string | null,
  code: NutrientCode,
): { factor: number; source: string } | null {
  if (!table) return null;
  const byQualifier = table.lookup.get(operation);
  if (!byQualifier) return null;
  const byNutrient =
    byQualifier.get(qualifier) ?? byQualifier.get(null) ?? null;
  return byNutrient?.get(code) ?? null;
}

/** Split a rollup across outputs by per-nutrient fractions. */
function splitRollup(
  source: Rollup,
  fractions: Partial<Record<NutrientCode, number[]>>,
  outputCount: number,
): Rollup[] {
  const out: Rollup[] = [];
  for (let i = 0; i < outputCount; i++) {
    const totals = {} as Record<NutrientCode, number | null>;
    const coverage = {} as Rollup["coverage"];
    const status = {} as Rollup["status"];
    for (const code of NUTRIENT_CODES) {
      const frac = fractions[code]?.[i] ?? 0;
      const value = source.totals[code];
      totals[code] = value == null ? null : value * frac;
      status[code] = source.status[code];
      coverage[code] = source.coverage[code]
        ? { ...source.coverage[code] }
        : { total: 0, known: 0 };
    }
    out.push({ totals, status, coverage });
  }
  return out;
}

export function computeGraph(
  graph: Graph,
  resolveProfile: (foodId: string) => NutrientProfile,
  options: ComputeOptions = {},
): GraphResult {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const edge of graph.edges) {
    if (!byId.has(edge.from)) throw new Error(`Edge from unknown node: ${edge.from}`);
    if (!byId.has(edge.to)) throw new Error(`Edge to unknown node: ${edge.to}`);
    incoming.get(edge.to)!.push(edge.from);
  }

  // Topological sort (Kahn), with a cycle message
  const indegree = new Map<string, number>();
  for (const [id, preds] of incoming) indegree.set(id, preds.length);
  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const remaining = new Map(indegree);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const edge of graph.edges) {
      if (edge.from !== id) continue;
      const next = (remaining.get(edge.to) ?? 1) - 1;
      remaining.set(edge.to, next);
      if (next === 0) queue.push(edge.to);
    }
  }
  if (order.length !== graph.nodes.length) {
    const cyclic = graph.nodes.map((n) => n.id).filter((id) => !order.includes(id));
    throw new Error(`Recipe graph has a cycle: ${cyclic.join(" → ")}`);
  }

  const nodeOutputs = new Map<string, Rollup[]>();
  const gramsOut = new Map<string, number[]>();
  const perNode = new Map<string, ComputedProcessNode>();
  let anyMeasuredOutput = false;

  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  for (const id of order) {
    const node = byId.get(id)!;

    if (node.type === "food") {
      const profile = resolveProfile(node.foodId);
      const result = rollup([{ label: node.foodId, profile, grams: node.grams }]);
      nodeOutputs.set(id, [result]);
      gramsOut.set(id, [node.grams]);
      continue;
    }

    // ---- process node ----
    const preds = incoming.get(id) ?? [];
    const inputEntries: { from: string; grams: number; profile: Rollup }[] = [];
    for (const predId of preds) {
      const pred = byId.get(predId)!;
      const outputs = nodeOutputs.get(predId)!;
      const grams = gramsOut.get(predId)!;
      // A consumed output is preferred; else the first output.
      const consumedIndex = pred.type === "process"
        ? Math.max(0, pred.outputs.findIndex((o) => o.tag === "consumed"))
        : 0;
      inputEntries.push({
        from: predId,
        grams: grams[consumedIndex] ?? 0,
        profile: outputs[consumedIndex],
      });
    }
    const inputs = inputEntries.map((entry) => ({ profile: entry.profile, grams: entry.grams }));
    const inputGrams = inputs.reduce((sum, entry) => sum + entry.grams, 0);

    const before = combine(inputs.map((entry) => entry.profile));

    // Factors: node overrides first, then the table, then LLM estimates
    const factors: AppliedFactor[] = [];
    const totals = { ...before.totals };
    const status = { ...before.status };
    const coverage = { ...before.coverage };
    for (const code of NUTRIENT_CODES) {
      const override = node.factorOverrides?.[code];
      const estimate = node.factorEstimates?.[code];
      const tableHit = tableLookup(options.factorTable, node.operation, node.qualifier ?? null, code);

      let factor: number | null = null;
      let source: AppliedFactor["source"] | null = null;
      if (override != null) {
        factor = override;
        source = "override";
      } else if (tableHit) {
        factor = tableHit.factor;
        source = "table";
      } else if (estimate != null) {
        factor = estimate;
        source = "estimated";
      }

      if (factor == null || source == null) continue;
      factors.push({ nutrient: code, factor, source });
      if (totals[code] != null) totals[code] = totals[code]! * factor;
      if (source === "estimated" && status[code] === "known") status[code] = "estimated";
    }

    const effective: Rollup = { totals, status, coverage };
    const unknownNutrients = NUTRIENT_CODES.filter((code) => before.totals[code] == null);

    // ---- split into outputs ----
    const outputCount = node.outputs.length;
    const fractions: Partial<Record<NutrientCode, number[]>> = {};
    for (const code of NUTRIENT_CODES) {
      if (outputCount === 1) {
        fractions[code] = [1];
        continue;
      }
      const declared = node.outputs.map((o) => o.split[code] ?? 0);
      const sum = declared.reduce((a, b) => a + b, 0);
      if (sum > 0) {
        fractions[code] = declared.map((v) => v / sum);
      } else {
        fractions[code] = declared.map((_, i) => (i === 0 ? 1 : 0));
      }
    }
    const after = splitRollup(effective, fractions, outputCount);

    // ---- mass per output ----
    const masses = node.outputs.map((_, index) => {
      const measured = node.measuredOutputs?.[index];
      if (measured != null && Number.isFinite(measured) && measured > 0) {
        anyMeasuredOutput = true;
        return measured;
      }
      // No measurement: split the input mass by the declared nutrient
      // fractions, falling back to an even split.
      const share = averageDeclaredShare(node, index);
      return inputGrams * share;
    });

    perNode.set(id, {
      id,
      name: node.name,
      operation: node.operation,
      qualifier: node.qualifier ?? null,
      before,
      after,
      factors,
      unknownNutrients,
      masses,
      inputGrams,
      inputEdges: inputEntries.map((entry) => ({ from: entry.from, grams: entry.grams })),
    });
    nodeOutputs.set(id, after);
    gramsOut.set(id, masses);
  }

  const consumedRolls: Rollup[] = [];
  const discardedRolls: Rollup[] = [];
  let consumedGrams = 0;
  let discardedGrams = 0;

  const pushTerminal = (nodeId: string) => {
    const outputs = nodeOutputs.get(nodeId)!;
    const grams = gramsOut.get(nodeId)!;
    const node = byId.get(nodeId)!;
    if (node.type === "food") {
      consumedRolls.push(outputs[0]);
      consumedGrams += grams[0];
      return;
    }
    node.outputs.forEach((output, index) => {
      if (output.tag === "consumed") {
        consumedRolls.push(outputs[index]);
        consumedGrams += grams[index];
      } else {
        discardedRolls.push(outputs[index]);
        discardedGrams += grams[index];
      }
    });
  };
  for (const node of graph.nodes) {
    if ((outgoing.get(node.id) ?? []).length === 0) pushTerminal(node.id);
  }

  const anyMeasuredAnywhere = anyMeasuredOutput;
  const measuredNodes = [...perNode.values()].some((n) =>
    n.masses.some((m) => m > 0),
  );
  void measuredNodes;

  return {
    perNode,
    consumed: combine(consumedRolls),
    consumedGrams,
    discarded: combine(discardedRolls),
    discardedGrams,
    inputGrams: graph.nodes
      .filter((n): n is GraphFoodNode => n.type === "food")
      .reduce((sum, n) => sum + n.grams, 0),
    yieldBasis: anyMeasuredAnywhere ? "measured" : "none",
  };
}

/** Average of the declared nutrient-share fractions for one output. */
function averageDeclaredShare(node: GraphProcessNode, index: number): number {
  const codes = NUTRIENT_CODES;
  const shares = codes.map((code) => {
    const declared = node.outputs.map((o) => o.split[code] ?? 0);
    const sum = declared.reduce((a, b) => a + b, 0);
    if (sum <= 0) return index === 0 ? 1 : 0;
    return declared[index] / sum;
  });
  const positive = shares.filter((s) => s > 0);
  if (positive.length === 0) return 1 / node.outputs.length;
  return positive.reduce((a, b) => a + b, 0) / positive.length;
}
