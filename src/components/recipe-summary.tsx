import { SparkleIcon } from "@/components/icons";
import type { Graph, GraphProcessNode } from "@/lib/nutrition/graph";

/**
 * The right pane when nothing is selected — a live digest of the recipe on
 * the canvas, instead of a placeholder. Everything shown is already computed
 * for the preview, so it costs nothing and is always in sync.
 */
export function RecipeSummary({
  name,
  versionNo,
  versionLabel,
  servings,
  foodCount,
  processCount,
  kcalPerServing,
  proteinPerServing,
  graph,
  instructions,
  onInstructionsChange,
  onAskAi,
}: {
  name: string;
  /** The loaded version number; null when the recipe is not saved yet. */
  versionNo: number | null;
  /** Optional version label, e.g. "less oil". */
  versionLabel?: string | null;
  servings: string;
  foodCount: number;
  processCount: number;
  /** Null when the graph does not produce an answer yet. */
  kcalPerServing: number | null;
  proteinPerServing: number | null;
  /** The live canvas graph — the steps are read from it. */
  graph?: Graph;
  /** The recipe's instructions — what this dish is. Editable inline. */
  instructions: string;
  onInstructionsChange: (value: string) => void;
  /** Run an AI prompt against this canvas. */
  onAskAi: (prompt: string) => void;
}) {
  const servingsNum = Number(servings);
  const validServings = Number.isFinite(servingsNum) && servingsNum > 0 ? Math.round(servingsNum * 10) / 10 : null;
  const steps = processOrder(graph);

  return (
    <div className="mt-2">
      <p className="font-ledger text-[9px] uppercase tracking-[0.22em] text-accent">
        Recipe summary
      </p>
      <h2 className="font-display mt-1.5 text-lg font-semibold leading-snug tracking-tight text-ink">
        {name.trim() || "Untitled recipe"}
      </h2>
      <p className="mt-1 text-[11px] text-muted">
        {versionNo != null ? `v${versionNo}` : "Unsaved"}
        {versionLabel ? ` · ${versionLabel}` : ""}
        {validServings != null ? ` · Serves ${validServings}` : ""}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat label="Ingredients" value={String(foodCount)} />
        <Stat label="Steps" value={String(processCount)} />
        <Stat
          label="Energy"
          value={kcalPerServing != null ? `${Math.round(kcalPerServing)} kcal` : "—"}
          unit={kcalPerServing != null ? "per serving" : "unknown"}
        />
        <Stat
          label="Protein"
          value={proteinPerServing != null ? `${Math.round(proteinPerServing * 10) / 10} g` : "—"}
          unit={proteinPerServing != null ? "per serving" : "unknown"}
        />
      </div>

      <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
            How it comes together
          </p>
          <button
            type="button"
            onClick={() => onAskAi("Rework the steps in this recipe — keep the same ingredients, tighten the order, and make each step name exactly what it is doing.")}
            aria-label="Rework the steps with AI"
            title="Rework the steps with AI"
            className="grid h-6 w-6 place-items-center rounded-md text-accent transition hover:bg-accent/10"
          >
            <SparkleIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {steps.length === 0 ? (
          <p className="mt-1.5 text-[11px] leading-snug text-muted">
            No steps on the canvas yet — it is just ingredients. Add a process block to describe what happens to them.
          </p>
        ) : (
          <ol className="mt-2 flex flex-wrap items-center gap-y-1.5">
            {steps.map((step, index) => (
              <li key={`${step}-${index}`} className="flex items-center">
                <span className="rounded-md border border-line bg-bg px-2 py-0.5 text-[11px] font-medium text-ink/80">
                  {index + 1}. {step}
                </span>
                {index < steps.length - 1 && (
                  <span aria-hidden="true" className="mx-1.5 text-[11px] text-accent/70">→</span>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-[9px] leading-snug text-ink/35">
          In order, from the first step to the last — this is what the boxes on the canvas mean.
        </p>
      </div>

      <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
            About this recipe
          </p>
          <button
            type="button"
            onClick={() => onAskAi("Write the instructions for this recipe — a short, confident introduction that is honest to what is on this canvas. No filler.")}
            aria-label="Write the summary with AI"
            title="Write the summary with AI"
            className="grid h-6 w-6 place-items-center rounded-md text-accent transition hover:bg-accent/10"
          >
            <SparkleIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <textarea
          value={instructions}
          onChange={(event) => onInstructionsChange(event.target.value)}
          rows={3}
          placeholder="A sentence or two about this dish — what it is, why it works, when to make it…"
          aria-label="About this recipe"
          className="mt-1.5 w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-[11px] leading-snug text-ink/85 placeholder:text-ink/30 focus:outline-none focus-visible:outline-none"
        />
        <p className="mt-1 text-[9px] leading-snug text-ink/35">
          What this recipe is — shown on the recipe page, saved with the version.
        </p>
      </div>

      <p className="mt-4 text-[10px] leading-snug text-faint">
        Select any block to edit its nutrients, or a connection to disconnect it. Drag blocks to arrange the canvas — positions are saved with the recipe.
      </p>
    </div>
  );
}

/**
 * The process steps in execution order — plain Kahn topological sort, stable
 * among ties by the canvas order. Display-only; computeGraph owns the real
 * math.
 */
function processOrder(graph: Graph | undefined): string[] {
  if (!graph) return [];
  const processes = graph.nodes.filter((n): n is GraphProcessNode => n.type === "process");
  if (processes.length === 0) return [];
  const ids = new Set(processes.map((n) => n.id));
  const indegree = new Map(processes.map((n) => [n.id, 0]));
  const outgoing = new Map(processes.map((n) => [n.id, [] as string[]]));
  for (const edge of graph.edges) {
    if (ids.has(edge.from) && ids.has(edge.to)) {
      outgoing.get(edge.from)!.push(edge.to);
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
  }
  const queue = processes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const node = processes.find((n) => n.id === id);
    if (node) result.push(node.name || node.operation || "Step");
    for (const to of outgoing.get(id) ?? []) {
      const next = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, next);
      if (next === 0) queue.push(to);
    }
  }
  return result;
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  /** Optional qualifier under the value. */
  unit?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-ink/40">{label}</p>
      <p className="tabular mt-0.5 text-base font-semibold leading-none text-ink">{value}</p>
      {unit ? <p className="mt-0.5 text-[9px] text-ink/35">{unit}</p> : null}
    </div>
  );
}
