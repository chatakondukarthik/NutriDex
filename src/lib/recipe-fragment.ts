/**
 * Recipe fragments: the copy/paste currency of the flow canvas.
 *
 * A fragment is a portable JSON envelope describing a *selection* of blocks
 * and the connections between them. It is the flavour of JSON the user asks
 * to copy out of one recipe and paste into another — a self-contained
 * sub-graph, never a pointer into another recipe.
 *
 * The parser is deliberately strict:
 *  - the envelope must self-identify (`app: "nutriplan-flow"`)
 *  - unknown envelope versions are rejected
 *  - node payloads are whitelisted; foreign keys are dropped, missing
 *    required ones reject the whole fragment with a specific error
 *  - every edge endpoint must resolve to a node inside the fragment
 * The engine re-checks everything else at save time (D-034: the model —
 * or in this case the clipboard — proposes, the engine disposes).
 */

export const FRAGMENT_APP = "nutriplan-flow" as const;
export const FRAGMENT_VERSION = 2 as const;

export interface FragmentNode {
  id: string;
  type: "food" | "process";
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FragmentEdge {
  id: string;
  from: string;
  to: string;
}

export interface RecipeFragment {
  app: typeof FRAGMENT_APP;
  version: typeof FRAGMENT_VERSION | 1;
  nodes: FragmentNode[];
  edges: FragmentEdge[];
}

export type ParseResult =
  | { ok: true; fragment: RecipeFragment }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* serialise                                                          */
/* ------------------------------------------------------------------ */

interface NodeLike {
  id: string;
  type?: string;
  position: { x: number; y: number };
  selected?: boolean;
  data?: unknown;
}

interface EdgeLike {
  id: string;
  source: string;
  target: string;
}

const FOOD_KEYS = ["foodId", "grams", "label"] as const;
const PROCESS_KEYS = [
  "name",
  "operation",
  "qualifier",
  "outputs",
  "measuredOutputs",
  "factorEstimates",
  "factorOverrides",
] as const;

function pick<T extends Record<string, unknown>>(source: T, keys: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) out[key] = structuredClone(source[key]);
  }
  return out;
}

/**
 * Serialise a selection into the fragment envelope.
 *
 * Only edges with both ends inside the selection are included, so a fragment
 * copied out of one recipe never carries dangling references into another.
 */
export function serializeFragment(
  nodes: NodeLike[],
  edges: EdgeLike[],
  selectedIds?: ReadonlySet<string>,
): string | null {
  const picked = selectedIds ? nodes.filter((n) => selectedIds.has(n.id)) : nodes;
  if (picked.length === 0) return null;

  const pickedIds = new Set(picked.map((n) => n.id));
  const internal = edges.filter((e) => pickedIds.has(e.source) && pickedIds.has(e.target));

  const cleanNodes: FragmentNode[] = picked.map((node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const keys = node.type === "food" ? FOOD_KEYS : PROCESS_KEYS;
    return {
      id: node.id,
      type: node.type === "food" ? "food" : "process",
      position: { x: node.position.x, y: node.position.y },
      // keep only data the engine understands; drop RF book-keeping
      data: pick(data, keys),
    };
  });

  const cleanEdges: FragmentEdge[] = internal.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
  }));

  const envelope: RecipeFragment = {
    app: FRAGMENT_APP,
    version: FRAGMENT_VERSION,
    nodes: cleanNodes,
    edges: cleanEdges,
  };
  return JSON.stringify(envelope, null, 2);
}

/* ------------------------------------------------------------------ */
/* parse                                                              */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function sanitizeSplit(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(value)) return out;
  for (const [code, amount] of Object.entries(value)) {
    const n = finiteNumber(amount);
    if (n != null && n >= 0) out[code] = n;
  }
  return out;
}

interface FragmentOutput {
  label: string;
  tag: "consumed" | "discarded";
  split: Record<string, number>;
}

function sanitizeOutputs(value: unknown): FragmentOutput[] {
  if (!Array.isArray(value)) return [];
  const out: { label: string; tag: "consumed" | "discarded"; split: Record<string, number> }[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const label = asString(entry.label) ?? "Output";
    const tag = entry.tag === "discarded" ? "discarded" : "consumed";
    out.push({ label, tag, split: sanitizeSplit(entry.split) });
  }
  return out;
}

function sanitizeRatioRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(value)) return out;
  for (const [key, amount] of Object.entries(value)) {
    const n = finiteNumber(amount);
    if (n != null && n >= 0 && n <= 4) out[key] = n;
  }
  return out;
}

function sanitizeMeasured(value: unknown, length: number): (number | null)[] {
  if (!Array.isArray(value)) return Array.from({ length }, () => null);
  return Array.from({ length }, (_, i) => {
    const n = finiteNumber(value[i]);
    return n != null && n >= 0 ? n : null;
  });
}

function sanitizeFoodData(data: Record<string, unknown>, errors: string[]) {
  const foodId = asString(data.foodId);
  if (!foodId) errors.push("a food block is missing its food id");
  const grams = finiteNumber(data.grams);
  if (grams == null || grams < 0) errors.push("a food block has no valid weight in grams");
  return {
    foodId: foodId ?? "unknown",
    grams: grams ?? 0,
    label: asString(data.label) ?? undefined,
  };
}

function sanitizeProcessData(data: Record<string, unknown>) {
  const outputs = sanitizeOutputs(data.outputs);
  const fixedOutputs =
    outputs.length > 0 ? outputs : [{ label: "Output", tag: "consumed" as const, split: {} }];
  return {
    name: asString(data.name) ?? "Step",
    operation: asString(data.operation) ?? "custom",
    qualifier: asString(data.qualifier) ?? null,
    outputs: fixedOutputs,
    measuredOutputs: sanitizeMeasured(data.measuredOutputs, fixedOutputs.length),
    factorEstimates: sanitizeRatioRecord(data.factorEstimates),
    factorOverrides: sanitizeRatioRecord(data.factorOverrides),
  };
}

/**
 * Parse and validate a fragment. Every failure returns a specific,
 * user-presentable reason; nothing from the input reaches the canvas
 * unless the whole fragment validates.
 */
export function parseRecipeFragment(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }

  if (!isRecord(raw)) return { ok: false, error: "Expected a fragment object." };
  if (raw.app !== FRAGMENT_APP) {
    return { ok: false, error: "That JSON is not a NutriPlan recipe fragment (missing app tag)." };
  }
  if (raw.version !== 1 && raw.version !== 2) {
    return { ok: false, error: `Unsupported fragment version ${String(raw.version)}.` };
  }
  if (!Array.isArray(raw.nodes)) return { ok: false, error: "The fragment has no blocks." };
  if (raw.nodes.length === 0) return { ok: false, error: "The fragment contains no blocks." };

  const errors: string[] = [];
  const nodes: FragmentNode[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of raw.nodes.entries()) {
    if (!isRecord(entry)) {
      errors.push(`block ${index + 1} is not an object`);
      continue;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(`block ${index + 1} is missing its id`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`block “${id}” appears twice`);
      continue;
    }
    seen.add(id);

    const type = entry.type === "food" ? "food" : entry.type === "process" ? "process" : null;
    if (!type) {
      errors.push(`block “${id}” is not a food or a process`);
      continue;
    }

    if (!isRecord(entry.position)) {
      errors.push(`block “${id}” has no position`);
      continue;
    }
    const x = finiteNumber(entry.position.x);
    const y = finiteNumber(entry.position.y);
    if (x == null || y == null) {
      errors.push(`block “${id}” has an invalid position`);
      continue;
    }

    const data = isRecord(entry.data) ? entry.data : {};
    nodes.push({
      id,
      type,
      position: { x, y },
      data: type === "food" ? sanitizeFoodData(data, errors) : sanitizeProcessData(data),
    });
  }

  if (errors.length > 0) return { ok: false, error: errors.join("; ") + "." };

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgesRaw = Array.isArray(raw.edges) ? raw.edges : [];
  const edges: FragmentEdge[] = [];
  const seenEdges = new Set<string>();

  for (const [index, entry] of edgesRaw.entries()) {
    if (!isRecord(entry)) {
      errors.push(`connection ${index + 1} is not an object`);
      continue;
    }
    // v1 fragments stored React Flow keys (source/target); v2 stores from/to.
    const from = asString(entry.from) ?? asString(entry.source);
    const to = asString(entry.to) ?? asString(entry.target);
    if (!from || !to) {
      errors.push(`connection ${index + 1} is missing an endpoint`);
      continue;
    }
    if (from === to) continue; // drop self-loops silently
    for (const endpoint of [from, to]) {
      if (!nodeIds.has(endpoint)) {
        errors.push(`connection “${from} → ${to}” references a block that is not in the fragment`);
        break;
      }
    }
    const key = `${from}→${to}`;
    if (seenEdges.has(key)) continue; // drop duplicate connections silently
    seenEdges.add(key);
    edges.push({ id: asString(entry.id) ?? `${from}-${to}`, from, to });
  }

  if (errors.length > 0) return { ok: false, error: errors.join("; ") + "." };

  return { ok: true, fragment: { app: FRAGMENT_APP, version: 2, nodes, edges } };
}
