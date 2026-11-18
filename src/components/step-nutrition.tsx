import type { Rollup } from "@/lib/nutrition/engine";
import { fmt } from "@/lib/format";
import { NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";
import type { GraphSnapshot } from "@/lib/recipes-v2";
import { computeGraph, type Graph } from "@/lib/nutrition/graph";
import { buildFactorTable, resolveProfile } from "@/lib/nutrition/graph-server";

interface StepNode {
  name: string;
  operation: string;
  qualifier: string | null;
  factors: { nutrient: NutrientCode; factor: number; source: string }[];
  unknownNutrients: NutrientCode[];
  before: Rollup;
  after: Rollup[];
  masses: number[];
  inputGrams: number;
}

const SOURCE_LABEL: Record<string, string> = {
  override: "edited",
  table: "lookup",
  estimated: "est",
};

export function StepNutrition({ snapshot }: { snapshot: GraphSnapshot }) {
  let perNode = snapshot.perNode as Record<string, StepNode> | undefined;

  if (!perNode || Object.keys(perNode).length === 0) {
    // Legacy v2 snapshots may lack the stored per-node detail; recompute it.
    try {
      const graph = (snapshot as { graph?: Graph }).graph;
      if (!graph) return null;
      const result = computeGraph(graph, resolveProfile, { factorTable: buildFactorTable() });
      perNode = {};
      for (const [id, node] of result.perNode) {
        (perNode as Record<string, StepNode>)[id] = {
          name: node.name,
          operation: node.operation,
          qualifier: node.qualifier,
          factors: node.factors,
          unknownNutrients: node.unknownNutrients,
          before: node.before,
          after: node.after,
          masses: node.masses,
          inputGrams: node.inputGrams,
        };
      }
    } catch {
      return null;
    }
  }

  const steps = Object.values(perNode);

  return (
    <section className="mt-4">
      <h2 className="font-display text-sm font-semibold tracking-tight text-ink">What each step did to the nutrients</h2>
      <p className="mt-0.5 text-[11px] text-ink/45">
        Before → after for every tracked nutrient, at each step. Factors marked “est”
        were estimated by the model and can be changed in the editor.
      </p>
      <div className="mt-3 space-y-3">
        {steps.map((step, index) => {
          const consumed = step.after[0];
          const changed = step.factors.length > 0;
          return (
            <div key={index} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">
                  <span className="mr-1.5 text-ink/35">{index + 1}.</span>
                  {step.name}
                  <span className="ml-2 rounded-md bg-ink/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-ink/50">
                    {step.operation}
                    {step.qualifier ? ` · ${step.qualifier}` : ""}
                  </span>
                </h3>
                <span className="tabular text-[11px] text-ink/45">
                  {fmt(step.inputGrams, 0)} g in · {fmt(step.masses[0] ?? null, 0)} g out
                </span>
              </div>

              {!changed ? (
                <p className="mt-2 text-[11px] text-ink/40">
                  No tracked nutrients changed in this step.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {step.factors.map((f) => {
                    const beforeVal = step.before.totals[f.nutrient];
                    const afterVal = consumed.totals[f.nutrient];
                    if (beforeVal == null || afterVal == null) return null;
                    const delta = afterVal - beforeVal;
                    const pct = beforeVal > 0 ? (delta / beforeVal) * 100 : null;
                    const meta = NUTRIENTS[f.nutrient];
                    return (
                      <li key={f.nutrient} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
                        <span className="text-ink/70">{meta.label}</span>
                        <span className="tabular flex items-baseline gap-2 text-ink/55">
                          <span>
                            {fmt(beforeVal, meta.precision)} → {fmt(afterVal, meta.precision)} {meta.unit}
                          </span>
                          {pct != null && (
                            <span className="font-medium text-ink/80">
                              {delta >= 0 ? "+" : ""}{Math.round(pct)}%
                            </span>
                          )}
                          <span className="rounded bg-ink/[0.07] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink/45">
                            {SOURCE_LABEL[f.source] ?? f.source}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {step.unknownNutrients.length > 0 && (
                <p className="mt-2 text-[10px] text-ink/35">
                  {step.unknownNutrients.length} tracked nutrient{step.unknownNutrients.length === 1 ? "" : "s"} not known for these inputs (shown as unknown).
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
