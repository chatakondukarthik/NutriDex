import type { Edge, Node } from "@xyflow/react";
import { cleanNote } from "@/lib/notes";
import type { Graph, GraphNode as EngineNode } from "@/lib/nutrition/graph";

/**
 * Serialize the *live canvas* — React Flow nodes and edges, including
 * unsaved edits — into the same `Graph` shape the model receives from a
 * stored recipe snapshot.
 *
 * The AI context contract: what is on your canvas is what the model sees,
 * quantized only by what can be interpolated into the prompt. Anything
 * derived from the canvas is still client input — the caller must pass it
 * through `sanitizeGraph` server-side.
 */
export function graphFromCanvas(nodes: Node[], edges: Edge[]): Graph {
  const engineNodes: EngineNode[] = [];
  for (const node of nodes) {
    if (node.type === "food") {
      const d = node.data as { foodId: string; grams: number; amount?: number | null; unit?: string | null; note?: string | null };
      engineNodes.push({
        id: node.id,
        type: "food",
        foodId: d.foodId,
        grams: d.grams,
        amount: d.amount ?? null,
        unit: d.unit ?? "g",
        note: cleanNote(d.note) ?? null,
      });
    } else {
      const d = node.data as unknown as {
        name: string; operation: string; qualifier: string | null;
        outputs: { label: string; tag: "consumed" | "discarded"; split: Record<string, number> }[];
        measuredOutputs: (number | null)[];
        factorEstimates: Record<string, number>;
        factorOverrides?: Record<string, number>;
        note?: string | null;
      };
      engineNodes.push({
        id: node.id,
        type: "process",
        operation: d.operation,
        qualifier: d.qualifier,
        name: d.name,
        measuredOutputs: d.measuredOutputs,
        outputs: d.outputs.map((o) => ({ label: o.label, tag: o.tag, split: o.split })),
        factorEstimates: d.factorEstimates as never,
        factorOverrides: d.factorOverrides as never,
        note: cleanNote(d.note) ?? null,
      });
    }
  }
  return {
    nodes: engineNodes,
    edges: edges.map((e) => ({ id: String(e.id), from: e.source, to: e.target })),
  };
}

/** True when the canvas carries at least one node worth sending as context. */
export function canvasHasContent(nodes: Node[]): boolean {
  return nodes.some((n) => n.type === "food" || n.type === "process");
}
