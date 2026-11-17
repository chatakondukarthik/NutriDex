/**
 * Shape validation for a client-supplied recipe graph.
 *
 * `saveGraphAction` is a public endpoint: the graph is whatever the caller
 * posted, not necessarily what the flow editor would produce. Counts alone
 * are not enough — the engine's cost and the stored nutrition both depend on
 * per-node internals:
 *
 *   - `outputs` drives `averageDeclaredShare`, which rescans every output for
 *     every nutrient. Unbounded outputs make one save quadratic (a 16 MB body
 *     can carry >100k empty outputs), so the cap is small and hard.
 *   - `grams`, `factorOverrides` and `split` are multiplied into stored
 *     totals. A negative/NaN gram count or a `1e9` factor would be persisted
 *     as real nutrition, so each is range-checked here.
 *   - duplicate node ids collapse the engine's `byId` map and double-count.
 *
 * Returns a user-facing message, or null when the graph is acceptable.
 */

import { NUTRIENT_CODES, type NutrientCode } from "./types";
import { MAX_GRAMS } from "./units";
import type { Graph } from "./graph";

const MAX_NODES = 300;
const MAX_EDGES = 600;
const MAX_LAYOUT_KEYS = 600;
/** More than a handful of outputs is not a real recipe, and the engine is O(n²). */
const MAX_OUTPUTS = 8;
const MAX_NAME = 200;
const MAX_NOTE = 2_000;
const MAX_OPERATION = 60;
const MAX_UNIT = "portion:".length + 80;
const MAX_FACTOR = 2;
const MAX_COORD = 1_000_000;

const CODES = new Set<string>(NUTRIENT_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteIn(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validateFactorMap(value: unknown, label: string): string | null {
  if (value == null) return null;
  if (!isRecord(value)) return `${label} is not valid.`;
  for (const [code, factor] of Object.entries(value)) {
    if (!CODES.has(code)) return `${label} names an unknown nutrient.`;
    if (!finiteIn(factor, 0, MAX_FACTOR)) return `${label} has an out-of-range factor.`;
  }
  return null;
}

function validateNode(node: unknown, seen: Set<string>): string | null {
  if (!isRecord(node)) return "That recipe graph is not valid.";
  const id = node.id;
  if (typeof id !== "string" || !id.trim() || id.length > MAX_NAME) {
    return "That recipe has an invalid node id.";
  }
  if (seen.has(id)) return "That recipe has duplicate node ids.";
  seen.add(id);

  if (node.note != null && (typeof node.note !== "string" || node.note.length > MAX_NOTE)) {
    return "A note on that recipe is too long.";
  }

  if (node.type === "food") {
    if (typeof node.foodId !== "string" || !node.foodId.trim() || node.foodId.length > MAX_NAME) {
      return "That ingredient is not valid.";
    }
    // `Number.MIN_VALUE` as the lower bound rejects 0 and every negative.
    if (!finiteIn(node.grams, Number.MIN_VALUE, MAX_GRAMS)) {
      return "An ingredient weight must be a positive number.";
    }
    if (node.amount != null && !finiteIn(node.amount, 0, MAX_GRAMS)) {
      return "An ingredient amount is out of range.";
    }
    if (node.unit != null && (typeof node.unit !== "string" || node.unit.length > MAX_UNIT)) {
      return "An ingredient unit is too long.";
    }
    return null;
  }

  if (node.type !== "process") return "That recipe has an unknown node type.";

  if (typeof node.operation !== "string" || !node.operation.trim() || node.operation.length > MAX_OPERATION) {
    return "A step operation is not valid.";
  }
  if (typeof node.name !== "string" || !node.name.trim() || node.name.length > MAX_NAME) {
    return "A step name is not valid.";
  }
  if (node.qualifier != null && (typeof node.qualifier !== "string" || node.qualifier.length > MAX_NAME)) {
    return "A step qualifier is too long.";
  }

  const outputs = node.outputs;
  if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > MAX_OUTPUTS) {
    return `A step needs between 1 and ${MAX_OUTPUTS} outputs.`;
  }
  for (const output of outputs) {
    if (!isRecord(output)) return "A step output is not valid.";
    if (typeof output.label !== "string" || output.label.length > MAX_NAME) {
      return "A step output label is too long.";
    }
    if (output.tag !== "consumed" && output.tag !== "discarded") {
      return "A step output tag is not valid.";
    }
    if (!isRecord(output.split)) return "A step split is not valid.";
    for (const [code, fraction] of Object.entries(output.split)) {
      if (!CODES.has(code)) return "A step split names an unknown nutrient.";
      if (!finiteIn(fraction, 0, 1)) return "A step split is out of range.";
    }
  }

  if (node.measuredOutputs != null) {
    const measured = node.measuredOutputs;
    if (!Array.isArray(measured) || measured.length !== outputs.length) {
      return "Measured outputs must line up with the step's outputs.";
    }
    for (const value of measured) {
      if (value != null && !finiteIn(value, Number.MIN_VALUE, MAX_GRAMS)) {
        return "A measured output is out of range.";
      }
    }
  }

  return (
    validateFactorMap(node.factorOverrides, "A step factor override") ??
    validateFactorMap(node.factorEstimates, "A step factor estimate")
  );
}

export function validateGraphShape(raw: unknown): string | null {
  if (!isRecord(raw)) return "That recipe graph is not valid.";
  const graph = raw as Partial<Graph>;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return "That recipe graph is not valid.";
  }
  if (graph.nodes.length === 0) return "Add at least one ingredient or step.";
  if (graph.nodes.length > MAX_NODES || graph.edges.length > MAX_EDGES) {
    return "That recipe is too large to save.";
  }

  const ids = new Set<string>();
  for (const node of graph.nodes) {
    const problem = validateNode(node, ids);
    if (problem) return problem;
  }

  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const edge of graph.edges) {
    if (!isRecord(edge)) return "That recipe has an invalid connection.";
    if (typeof edge.id !== "string" || !edge.id || edge.id.length > MAX_NAME) {
      return "That recipe has an invalid connection id.";
    }
    if (edgeIds.has(edge.id)) return "That recipe has duplicate connection ids.";
    edgeIds.add(edge.id);
    if (typeof edge.from !== "string" || typeof edge.to !== "string") {
      return "That recipe has an invalid connection.";
    }
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      return "That recipe connects to an unknown node.";
    }
    if (edge.from === edge.to) return "A step cannot feed itself.";
    const pair = `${edge.from}->${edge.to}`;
    if (pairs.has(pair)) return "That recipe has a duplicate connection.";
    pairs.add(pair);
  }

  return null;
}

/** Layout is persisted and re-sent on every read, so bound its shape too. */
export function validateLayout(raw: unknown): string | null {
  if (raw == null) return null;
  if (!isRecord(raw)) return "That layout is not valid.";
  const keys = Object.keys(raw);
  if (keys.length > MAX_LAYOUT_KEYS) return "That layout is too large.";
  for (const key of keys) {
    if (key.length > MAX_NAME) return "That layout has an invalid key.";
    const value = raw[key];
    if (
      !isRecord(value) ||
      !finiteIn(value.x, -MAX_COORD, MAX_COORD) ||
      !finiteIn(value.y, -MAX_COORD, MAX_COORD)
    ) {
      return "That layout has an invalid position.";
    }
  }
  return null;
}

/** Convenience for callers that only have a nutrient code string. */
export function isNutrientCode(value: string): value is NutrientCode {
  return CODES.has(value);
}

/** Keep only known nutrient codes with a numeric value. */
function pickFactors(value: unknown): Partial<Record<NutrientCode, number>> {
  const out: Partial<Record<NutrientCode, number>> = {};
  if (!isRecord(value)) return out;
  for (const [code, factor] of Object.entries(value)) {
    if (CODES.has(code) && typeof factor === "number") out[code as NutrientCode] = factor;
  }
  return out;
}

/**
 * Rebuild a validated graph from its known fields.
 *
 * Validation bounds counts and ranges, but the original objects also carry
 * whatever extra keys the caller posted. `normalizeGraphNotes` spreads a
 * node and the snapshot stores the layout value whole, so a 16 MB `blob` on
 * one node would be persisted and re-sent on every read. Copying only the
 * fields the engine and editor use drops everything else.
 *
 * Call this only after `validateGraphShape` returns null.
 */
export function sanitizeGraph(raw: unknown): Graph {
  const graph = raw as Graph;
  return {
    nodes: graph.nodes.map((node) => {
      if (node.type === "food") {
        return {
          id: node.id,
          type: "food",
          foodId: node.foodId,
          grams: node.grams,
          ...(node.amount != null ? { amount: node.amount } : {}),
          ...(node.unit != null ? { unit: node.unit } : {}),
          ...(node.note != null ? { note: node.note } : {}),
        };
      }
      return {
        id: node.id,
        type: "process",
        operation: node.operation,
        name: node.name,
        outputs: node.outputs.map((output) => ({
          label: output.label,
          tag: output.tag,
          split: pickFactors(output.split),
        })),
        ...(node.qualifier != null ? { qualifier: node.qualifier } : {}),
        ...(node.measuredOutputs != null
          ? { measuredOutputs: node.measuredOutputs.map((value) => value ?? null) }
          : {}),
        ...(node.factorOverrides != null
          ? { factorOverrides: pickFactors(node.factorOverrides) }
          : {}),
        ...(node.factorEstimates != null
          ? { factorEstimates: pickFactors(node.factorEstimates) }
          : {}),
        ...(node.note != null ? { note: node.note } : {}),
      };
    }),
    edges: graph.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
  };
}

/**
 * Rebuild a validated layout from its `x`/`y` fields, dropping any extra
 * keys the caller attached to a position.
 *
 * Call this only after `validateLayout` returns null.
 */
export function sanitizeLayout(
  raw: unknown,
): Record<string, { x: number; y: number }> | undefined {
  if (raw == null) return undefined;
  const out: Record<string, { x: number; y: number }> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const position = value as { x: number; y: number };
    out[key] = { x: position.x, y: position.y };
  }
  return out;
}
