"use client";

import { memo } from "react";
import { Handle, Position, useNodeConnections, type NodeProps } from "@xyflow/react";

export type FoodNodeData = {
  label: string;
  grams: number;
  unknownCount: number;
};

export type ProcessNodeData = {
  name: string;
  operation: string;
  outputs: { label: string; tag: "consumed" | "discarded" | string }[];
};

export const FoodNode = memo(function FoodNode({ data, selected }: NodeProps) {
  const d = data as FoodNodeData;
  return (
    <div
      className={`min-w-[170px] rounded-xl border bg-surface px-3 py-2 shadow-card transition ${
        selected ? "border-accent ring-2 ring-accent/20" : "border-line"
      }`}
    >
      <Handle type="source" position={Position.Right} id="out" className="!bg-accent" />
      <div className="text-[10px] font-medium uppercase tracking-wider text-ink/40">Ingredient</div>
      <div className="mt-0.5 text-sm font-semibold leading-tight">{d.label}</div>
      <div className="tabular mt-0.5 text-[11px] text-ink/55">
        {d.grams} g{d.unknownCount > 0 && <span className="ml-1.5 text-warn-ink">{d.unknownCount} unknown</span>}
      </div>
    </div>
  );
});

export const ProcessNode = memo(function ProcessNode({ data, selected }: NodeProps) {
  const d = data as ProcessNodeData;
  const targetConns = useNodeConnections({ handleType: "target" });
  const outConns = useNodeConnections({ handleType: "source" });
  const outputs = d.outputs ?? [];
  const discarded = outputs.filter((o) => o.tag === "discarded").length;
  return (
    <div
      className={`min-w-[190px] rounded-xl border bg-surface px-3 py-2 shadow-card transition ${
        selected ? "border-accent ring-2 ring-accent/20" : "border-line"
      }`}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" className="!bg-accent" />
      <div className="text-[10px] font-medium uppercase tracking-wider text-ink/40">
        {d.operation}
      </div>
      <div className="mt-0.5 text-sm font-semibold leading-tight">{d.name}</div>
      <div className="tabular mt-1 text-[10px] text-ink/40">
        {targetConns.length} in · {outConns.length} out · {outputs.length} product{outputs.length === 1 ? "" : "s"}
        {discarded > 0 && <span className="ml-1.5 text-warn-ink">{discarded} discarded</span>}
      </div>
    </div>
  );
});

export const nodeTypes = { food: FoodNode, process: ProcessNode };
