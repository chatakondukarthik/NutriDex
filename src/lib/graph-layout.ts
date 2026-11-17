/**
 * Shared graph auto-layout.
 *
 * Used by the flow editor's "Auto-layout" button and by the AI materializer,
 * so a recipe created or edited through AI arrives already arranged instead
 * of falling back to the naive two-column placeholder layout.
 */

import dagre from "@dagrejs/dagre";

export interface LayoutNode {
  id: string;
  /** "food" | "process" — only affects the reserved box size. */
  type?: string | null;
  /** Noted blocks render a two-line preview, so they need a taller box. */
  note?: string | null;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

const MARGIN = 40;

/**
 * Arrange nodes left-to-right (ingredients → steps → downstream steps) and
 * return top-left positions keyed by node id. Deterministic for a given
 * node/edge order. Edges that reference unknown nodes are skipped rather
 * than throwing, so a stale edge can never break a save.
 */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return positions;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });

  for (const node of nodes) {
    const noted = !!node.note?.trim();
    g.setNode(node.id, {
      width: node.type === "food" ? 190 : 210,
      height: noted ? 150 : 110,
    });
  }
  for (const edge of edges) {
    if (!g.hasNode(edge.from) || !g.hasNode(edge.to)) continue;
    if (edge.from === edge.to) continue;
    g.setEdge(edge.from, edge.to);
  }

  dagre.layout(g);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (!pos) continue;
    const x = pos.x - pos.width / 2;
    const y = pos.y - pos.height / 2;
    positions[node.id] = { x, y };
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }

  // Dagre can centre a lone node at the origin; keep everything inside a
  // small positive frame so the canvas starts with a margin.
  const shiftX = Number.isFinite(minX) && minX < MARGIN ? MARGIN - minX : 0;
  const shiftY = Number.isFinite(minY) && minY < MARGIN ? MARGIN - minY : 0;
  if (shiftX || shiftY) {
    for (const pos of Object.values(positions)) {
      pos.x = Math.round(pos.x + shiftX);
      pos.y = Math.round(pos.y + shiftY);
    }
  }
  return positions;
}
