"use client";

import { memo } from "react";
import { Handle, Position, useNodeConnections, type NodeProps } from "@xyflow/react";

export type FoodNodeData = {
  label: string;
  grams: number;
  /** The quantity as entered — e.g. amount: 10, unit: "portion:1 large". */
  amount?: number | null;
  unit?: string | null;
  unknownCount: number;
  note?: string | null;
};

export type ProcessNodeData = {
  name: string;
  operation: string;
  outputs: { label: string; tag: "consumed" | "discarded" | string }[];
  note?: string | null;
};

/** Quantity as typed — "10 large", "2 tbsp" — for the ingredients line. */
function quantityLabel(amount?: number | null, unit?: string | null): string | null {
  if (amount == null || !unit) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 10) / 10;
  const amountText = String(rounded);
  const key = unit.trim();
  if (key.startsWith("portion:")) {
    // Portion labels are authored "1 large" — strip a leading "1 " for plural display.
    const label = key.slice("portion:".length).replace(/^1\s+/, "");
    return `${amountText} ${label}`;
  }
  if (key === "g") return `${amountText} g`;
  if (key === "kg") return `${amountText} kg`;
  if (key === "oz") return `${amountText} oz`;
  if (key === "lb") return `${amountText} lb`;
  if (key === "ml") return `${amountText} ml`;
  if (key === "l") return `${amountText} l`;
  if (key === "tsp") return `${amountText} tsp`;
  if (key === "tbsp") return `${amountText} tbsp`;
  if (key === "fl_oz") return `${amountText} fl oz`;
  if (key === "cup") return `${amountText} cup`;
  return `${amountText} ${key}`;
}

/** Two-line clamped note preview; the full text lives in the inspector. */
function NotePreview({ note }: { note?: string | null }) {
  if (!note) return null;
  return (
    <p
      className="mt-1 max-w-[190px] whitespace-pre-wrap break-words text-[10px] italic leading-snug text-ink/45"
      style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      title={note}
    >
      {note}
    </p>
  );
}

export const FoodNode = memo(function FoodNode({ data, selected }: NodeProps) {
  const d = data as FoodNodeData;
  return (
    <div
      className={`min-w-[170px] rounded-xl border bg-surface px-3 py-2 shadow-card transition ${
        selected ? "border-accent ring-2 ring-accent/20" : "border-line"
      }`}
    >
      <Handle type="source" position={Position.Right} id="out" className="!bg-accent" aria-label="Output — connect to a step input" role="button" title="Output" />
      <div className="text-[10px] font-medium uppercase tracking-wider text-ink/40">Ingredient</div>
      <div className="mt-0.5 text-sm font-semibold leading-tight">{d.label}</div>
      <div className="tabular mt-0.5 text-[11px] text-ink/55">
        {(() => {
          const quantity = quantityLabel(d.amount, d.unit);
          return quantity ? (
            <>
              <span className="font-medium text-ink/70">{quantity}</span>
              <span className="mx-1.5 text-ink/30">·</span>
            </>
          ) : null;
        })()}
        {d.grams} g{d.unknownCount > 0 && <span className="ml-1.5 text-warn-ink">{d.unknownCount} unknown</span>}
      </div>
      <NotePreview note={d.note} />
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
      <Handle type="target" position={Position.Left} id="in" aria-label="Input — connect an ingredient output here" role="button" title="Input" />
      <Handle type="source" position={Position.Right} id="out" className="!bg-accent" aria-label="Output — connect to a step input" role="button" title="Output" />
      <div className="text-[10px] font-medium uppercase tracking-wider text-ink/40">
        {d.operation}
      </div>
      <div className="mt-0.5 text-sm font-semibold leading-tight">{d.name}</div>
      <div className="tabular mt-1 text-[10px] text-ink/40">
        {targetConns.length} in · {outConns.length} out · {outputs.length} product{outputs.length === 1 ? "" : "s"}
        {discarded > 0 && <span className="ml-1.5 text-warn-ink">{discarded} discarded</span>}
      </div>
      <NotePreview note={d.note} />
    </div>
  );
});

export const nodeTypes = { food: FoodNode, process: ProcessNode };
