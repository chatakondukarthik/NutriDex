"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type FoodNodeData = {
  label: string;
  grams: number;
  unknownCount: number;
};

export type ProcessNodeData = {
  name: string;
  operation: string;
  deltaSummary: string;
  massIn: number;
  massOut: number;
  factorCount: number;
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
      <div className="tabular mt-0.5 text-[11px] text-ink/55">{d.grams} g</div>
    </div>
  );
});

export const ProcessNode = memo(function ProcessNode({ data, selected }: NodeProps) {
  const d = data as ProcessNodeData;
  return (
    <div
      className={`min-w-[190px] rounded-xl border bg-surface px-3 py-2 shadow-card transition ${
        selected ? "border-accent ring-2 ring-accent/20" : "border-line"
      }`}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" className="!bg-accent" />
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-ink/40">
          {d.operation}
        </div>
        {d.factorCount > 0 && (
          <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] font-semibold text-accent">
            {d.factorCount} Δ
          </span>
        )}
      </div>
      <div className="mt-0.5 text-sm font-semibold leading-tight">{d.name}</div>
      {d.deltaSummary && (
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-ink/50">
          {d.deltaSummary}
        </div>
      )}
      <div className="tabular mt-1 text-[10px] text-ink/40">
        {Math.round(d.massIn)} g in → {Math.round(d.massOut)} g out
      </div>
    </div>
  );
});

export const nodeTypes = { food: FoodNode, process: ProcessNode };
