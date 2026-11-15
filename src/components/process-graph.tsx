"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProcessGraph, ProcessNode } from "@/lib/recipe-graph";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 120;
const V_GAP = 60;
const H_GAP = 40;

function layout(graph: ProcessGraph): { nodes: Node[]; edges: Edge[] } {
  const order = topoOrder(graph);
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));

  // group by rank for horizontal placement
  const byRank = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const r = rank.get(node.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(node.id);
  }

  const nodes: Node[] = graph.nodes.map((node) => {
    const r = rank.get(node.id) ?? 0;
    const siblings = byRank.get(r) ?? [node.id];
    const idx = siblings.indexOf(node.id);
    const x = idx * (NODE_WIDTH + H_GAP);
    const y = r * (NODE_HEIGHT + V_GAP);
    return {
      id: node.id,
      position: { x, y },
      data: { label: node.label, node },
      type: "processNode",
    };
  });

  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.from,
    target: e.to,
    animated: true,
  }));

  // Also add edges from implicit inputs (node -> node)
  for (const node of graph.nodes) {
    for (const input of node.inputs) {
      if (input.source.type === "node") {
        const from = input.source.nodeId;
        if (!edges.some((e) => e.source === from && e.target === node.id)) {
          edges.push({ id: `ei-${from}-${node.id}`, source: from, target: node.id });
        }
      }
    }
  }

  return { nodes, edges };
}

function topoOrder(graph: ProcessGraph): string[] {
  // Simple topological sort by dependsOn + inputs.
  const visited = new Set<string>();
  const result: string[] = [];
  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    const deps = new Set<string>(node.dependsOn);
    for (const inp of node.inputs) {
      if (inp.source.type === "node") deps.add(inp.source.nodeId);
    }
    for (const d of deps) visit(d);
    result.push(id);
  }
  for (const node of graph.nodes) visit(node.id);
  return result;
}

function ProcessNodeCard({ data }: { data: { label: string; node: ProcessNode } }) {
  const node = data.node;
  return (
    <div className="rounded-lg border border-line bg-surface p-3 shadow-card" style={{ width: NODE_WIDTH }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">{node.id}</span>
        <span className="rounded-md bg-ink/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-ink/50">
          {node.operation}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium">{node.label}</p>
      {node.outputMassG != null && (
        <p className="mt-1 text-[10px] text-ink/40">{node.outputMassG} g out</p>
      )}
    </div>
  );
}

const nodeTypes = { processNode: ProcessNodeCard };

export function ProcessGraphView({ graph }: { graph: ProcessGraph }) {
  const { nodes, edges } = useMemo(() => layout(graph), [graph]);
  return (
    <div className="h-[420px] w-full rounded-lg border border-line bg-canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
