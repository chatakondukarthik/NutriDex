"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { saveGraphAction, estimateNodeDeltasAction } from "@/app/actions";
import { searchFoods } from "@/lib/nutrition/food-search";
import { computeGraph, type Graph, type GraphNode as EngineNode, type GraphProcessNode } from "@/lib/nutrition/graph";
import dagre from "@dagrejs/dagre";
import { tableFromRows, type FactorRow } from "@/lib/nutrition/factor-table";
import { fmt } from "@/lib/format";
import type { Food } from "@/lib/nutrition/types";
import { nodeTypes } from "@/components/flow-nodes";

const OPERATION_OPTIONS = [
  "assemble", "mix", "boil", "pressure-cook", "steam", "sauté", "fry", "deep-fry",
  "roast", "bake", "grill", "blend", "strain", "reduce", "cool", "refrigerate",
  "freeze", "marinate", "ferment", "wash", "soak", "grate", "dice", "slice", "chop",
];

export interface FlowEditorProps {
  foods: Food[];
  factorRows: FactorRow[];
  recipeId: string | null;
  initialGraph?: Graph | null;
  initialLayout?: Record<string, { x: number; y: number }>;
  initialName?: string;
  initialInstructions?: string;
  initialServings?: string;
  initialVersionLabel?: string;
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowEditorInner({
  foods,
  factorRows,
  recipeId,
  initialGraph,
  initialLayout,
  initialName = "",
  initialInstructions = "",
  initialServings = "1",
  initialVersionLabel = "",
}: FlowEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [versionLabel, setVersionLabel] = useState(initialVersionLabel);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [servings, setServings] = useState(initialServings);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasteOffset, setPasteOffset] = useState(0);
  const historyRef = useRef<{ past: { nodes: Node[]; edges: Edge[] }[]; future: { nodes: Node[]; edges: Edge[] }[] }>({ past: [], future: [] });
  const noticeTimer = useRef<number | null>(null);
  const reactFlow = useReactFlow();

  function flashNotice(text: string) {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 1800);
  }

  const factorTable = useMemo(() => tableFromRows(factorRows), [factorRows]);

  const [nodes, setNodes] = useState<Node[]>(() => buildInitialNodes(initialGraph, initialLayout, foods));
  // Auto-layout once when opening an existing recipe without a stored layout
  const layoutDone = useRef(!!initialLayout);
  useEffect(() => {
    if (layoutDone.current) return;
    layoutDone.current = true;
    // give React Flow one frame to mount, then arrange
    const id = window.setTimeout(() => autoLayout(), 120);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [edges, setEdges] = useState<Edge[]>(() => buildInitialEdges(initialGraph));
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  const selectionRef = useRef<string[]>([]);

  const resolve = useCallback(
    (foodId: string) => foods.find((f) => f.id === foodId)?.nutrients ?? (() => { throw new Error("unknown food"); })(),
    [foods],
  );

  const graph = useMemo<Graph>(() => buildGraph(nodes, edges), [nodes, edges]);
  const preview = useMemo(() => {
    try {
      return { result: computeGraph(graph, resolve, { factorTable }), error: null as string | null };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : "Could not compute." };
    }
  }, [graph, resolve, factorTable]);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedProcess = preview.result?.perNode.get(selectedId ?? "") ?? null;

  function addFood(food: Food) {
    const id = crypto.randomUUID();
    const foodNode: Node = {
      id,
      type: "food",
      position: { x: 80 + Math.random() * 120, y: 80 + Math.random() * 160 },
      data: {
        label: food.name,
        grams: 100,
        foodId: food.id,
        unknownCount: Object.values(food.nutrients).filter((v) => v.amount == null).length,
      },
    };
    const current = nodesRef.current;
    const next = [...current, foodNode];
    nodesRef.current = next;
    setNodes(next);
    // Auto-connect: selected process, or the only process node on the canvas
    const target =
      current.find((n) => n.id === selectedId && n.type === "process") ??
      (current.filter((n) => n.type === "process").length === 1
        ? current.find((n) => n.type === "process")
        : undefined);
    if (target) {
      setEdges((edges) => [...edges, { id: crypto.randomUUID(), source: id, target: target.id }]);
    }
    setSelectedId(id);
    setTimeout(() => reactFlow.fitView({ padding: 0.2 }), 60);
  }

  function addProcess() {
    const id = crypto.randomUUID();
    const processNode: Node = {
      id,
      type: "process",
      position: { x: 340 + Math.random() * 80, y: 100 + Math.random() * 220 },
      data: {
        name: "New step",
        operation: "assemble",
        qualifier: null,
        outputs: [{ label: "Output", tag: "consumed", split: {} }],
        measuredOutputs: [null],
        factorEstimates: {},
        factorOverrides: {},
      },
    };
    const current = nodesRef.current;
    const foodNodes = current.filter((n) => n.type === "food");
    const next = [...current, processNode];
    nodesRef.current = next;
    setNodes(next);
    if (foodNodes.length) {
      setEdges((edges) => [
        ...edges,
        ...foodNodes.map((f) => ({ id: crypto.randomUUID(), source: f.id, target: id })),
      ]);
    }
    setSelectedId(id);
    setTimeout(() => reactFlow.fitView({ padding: 0.2 }), 60);
  }

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      const ids = selectedNodes.map((n) => n.id);
      selectionRef.current = ids;
      setSelectionIds((prev) =>
        prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
      );
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );
  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID() }, current)),
    [],
  );

  function autoLayout() {
    setNodes((current) => {
      const g = new dagre.graphlib.Graph();
      g.setDefaultEdgeLabel(() => ({}));
      g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
      for (const n of current) g.setNode(n.id, { width: 210, height: 110 });
      for (const e of edges) g.setEdge(e.source, e.target);
      dagre.layout(g);
      return current.map((n) => {
        const pos = g.node(n.id);
        return pos ? { ...n, position: { x: pos.x - 105, y: pos.y - 55 } } : n;
      });
    });
  }

  function patchNode(id: string, patch: Record<string, unknown>) {
    setNodes((current) =>
      current.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  }

  function removeNode(id: string) {
    setNodes((current) => current.filter((n) => n.id !== id));
    setEdges((current) => current.filter((e) => e.source !== id && e.target !== id));
    if (selectedId === id) setSelectedId(null);
  }

  // ---- history (undo/redo) ----------------------------------------------
  const lastSnapshotRef = useRef<string>("");
  useEffect(() => {
    const snapshot = JSON.stringify({ nodes, edges });
    if (snapshot === lastSnapshotRef.current) return;
    const timer = window.setTimeout(() => {
      lastSnapshotRef.current = snapshot;
      const past = historyRef.current.past;
      const last = past[past.length - 1];
      if (last && JSON.stringify(last.nodes) === JSON.stringify(nodes) && JSON.stringify(last.edges) === JSON.stringify(edges)) return;
      past.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
      if (past.length > 60) past.shift();
      historyRef.current.future = [];
    }, 250);
    return () => window.clearTimeout(timer);
  }, [nodes, edges]);

  function undo() {
    const { past, future } = historyRef.current;
    if (past.length === 0) return;
    const current = past[past.length - 1];
    const previous = past[past.length - 2];
    if (!previous) {
      flashNotice("Nothing to undo.");
      return;
    }
    past.pop();
    future.push(current);
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setSelectedId(null);
    setSelectionIds([]);
  }

  function redo() {
    const { past, future } = historyRef.current;
    if (future.length === 0) return;
    const next = future.pop()!;
    past.push(next);
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedId(null);
    setSelectionIds([]);
  }

  // ---- copy / paste -------------------------------------------------------
  function selectedNodeIds(): string[] {
    return selectionRef.current.length ? selectionRef.current : selectedId ? [selectedId] : [];
  }

  function copySelection() {
    const ids = new Set(selectedNodeIds());
    if (ids.size === 0) {
      flashNotice("Select a block first.");
      return;
    }
    const picked = nodesRef.current.filter((n) => ids.has(n.id));
    const pickedIds = new Set(picked.map((n) => n.id));
    const crossEdges = edges.filter((e) => pickedIds.has(e.source) && pickedIds.has(e.target));
    const payload = { app: "nutriplan-flow", version: 1, nodes: structuredClone(picked), edges: structuredClone(crossEdges) };
    try {
      navigator.clipboard?.writeText(JSON.stringify(payload)).catch(() => {});
    } catch {
      /* clipboard unavailable; keep internal copy */
    }
    internalClipboardRef.current = payload;
    flashNotice(`Copied ${picked.length} block${picked.length === 1 ? "" : "s"}.`);
  }

  const internalClipboardRef = useRef<{ app: string; nodes: Node[]; edges: Edge[] } | null>(null);

  function pasteClipboard() {
    const clip = internalClipboardRef.current;
    if (!clip || clip.app !== "nutriplan-flow") {
      if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        navigator.clipboard.readText().then((text) => {
          try {
            const parsed = JSON.parse(text);
            if (parsed?.app === "nutriplan-flow") doPaste(parsed);
            else flashNotice("Nothing to paste.");
          } catch {
            flashNotice("Nothing to paste.");
          }
        }).catch(() => flashNotice("Nothing to paste."));
      } else {
        flashNotice("Nothing to paste.");
      }
      return;
    }
    doPaste(clip);
  }

  function doPaste(clip: { nodes: Node[]; edges: Edge[] }) {
    const idMap = new Map<string, string>();
    for (const node of clip.nodes) idMap.set(node.id, crypto.randomUUID());
    const offset = 40 * (pasteOffset + 1);
    setPasteOffset((n) => n + 1);
    const pastedNodes: Node[] = clip.nodes.map((node) => ({
      ...structuredClone(node),
      id: idMap.get(node.id)!,
      position: { x: node.position.x + offset, y: node.position.y + offset },
      selected: true,
    }));
    const pastedEdges: Edge[] = clip.edges.map((edge) => ({
      ...structuredClone(edge),
      id: crypto.randomUUID(),
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
    }));
    setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), ...pastedNodes]);
    setEdges((current) => [...current, ...pastedEdges]);
    const pastedIds = pastedNodes.map((n) => n.id);
    selectionRef.current = pastedIds;
    setSelectionIds(pastedIds);
    setSelectedId(null);
    flashNotice(`Pasted ${pastedNodes.length} block${pastedNodes.length === 1 ? "" : "s"}.`);
  }

  // ---- keyboard shortcuts ------------------------------------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const editable = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (editable) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((mod && key === "z" && e.shiftKey) || (mod && key === "y")) { e.preventDefault(); redo(); return; }
      if (mod && key === "c") { copySelection(); return; }
      if (mod && key === "v") { e.preventDefault(); pasteClipboard(); return; }
      if (key === "escape") {
        selectionRef.current = [];
        setSelectedId(null);
        setSelectionIds([]);
        setNodes((current) => current.map((n) => ({ ...n, selected: false })));
        setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
        return;
      }
      if (key === "delete" || key === "backspace") {
        const ids = selectedNodeIds();
        if (ids.length === 0) return;
        e.preventDefault();
        selectionRef.current = [];
        setNodes((current) => current.filter((n) => !ids.includes(n.id)));
        setEdges((current) => current.filter((edge) => !ids.includes(edge.source) && !ids.includes(edge.target)));
        setSelectionIds([]);
        setSelectedId(null);
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        const all = nodesRef.current.map((n) => n.id);
        selectionRef.current = all;
        setSelectionIds(all);
        setNodes((current) => current.map((n) => ({ ...n, selected: true })));
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionIds, selectedId, nodes, edges]);

  async function askAi() {
    if (!selectedNode || selectedNode.type !== "process") return;
    setEstimating(true);
    setError(null);
    try {
      const estimate = await estimateNodeDeltasAction({
        operation: String(selectedNode.data.operation),
        qualifier: (selectedNode.data.qualifier as string | null) ?? null,
        inputs: inputsForNode(selectedNode.id, edges, nodes, foods),
      });
      if (!estimate.ok || !estimate.estimate) {
        setError(estimate.message ?? "The model could not estimate this step.");
        return;
      }
      const factorEstimates: Record<string, number> = {};
      for (const f of estimate.estimate.factors) factorEstimates[f.nutrient] = f.factor;
      patchNode(selectedNode.id, { factorEstimates });
    } finally {
      setEstimating(false);
    }
  }

  function onSave() {
    setError(null);
    if (!name.trim()) { setError("Give the recipe a name."); return; }
    const servingsNum = Number(servings);
    if (!Number.isFinite(servingsNum) || servingsNum <= 0) { setError("Servings must be positive."); return; }
    if (preview.error) { setError(preview.error); return; }

    const layout: Record<string, { x: number; y: number }> = {};
    for (const node of nodes) layout[node.id] = { x: node.position.x, y: node.position.y };

    startTransition(async () => {
      const result = await saveGraphAction({
        recipeId,
        name,
        versionLabel: versionLabel || null,
        instructions,
        servings: servingsNum,
        layout,
        graph,
      });
      if (!result.ok) { setError(result.message ?? "Save failed."); return; }
      router.push(`/recipes/${result.recipeId}`);
      router.refresh();
    });
  }

  const queryResults = query.trim() ? searchFoods(foods, query).slice(0, 6) : [];

  return (
    <div className="relative flex h-[calc(100vh-57px)] flex-col">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Recipe name"
          aria-label="Recipe name"
          className="min-w-[180px] flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm font-semibold"
        />
        <input
          value={versionLabel}
          onChange={(e) => setVersionLabel(e.target.value)}
          placeholder="Version note (optional)"
          aria-label="Version note"
          className="w-40 rounded-md border border-line bg-bg px-2 py-2 text-xs"
        />
        <label className="flex items-center gap-1 text-xs text-muted">
          Serves
          <input
            type="number"
            min={1}
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            className="w-16 rounded-md border border-line bg-bg px-2 py-2 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={autoLayout}
          className="rounded-md border border-line bg-bg px-3 py-2 text-xs font-medium text-muted hover:text-ink"
        >
          Auto-layout
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !nodes.length}
          className="rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-fg disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save recipe"}
        </button>
      </div>

      {error && (
        <div className="border-b border-danger-line bg-danger-soft px-4 py-1.5 text-xs text-danger-ink">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* palette */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-line bg-surface p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search foods…"
            aria-label="Search foods"
            className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-xs"
          />
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-auto">
            {queryResults.map((food) => (
              <li key={food.id}>
                <button
                  type="button"
                  onClick={() => addFood(food)}
                  className="w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-ink/5"
                >
                  {food.name}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addProcess}
            className="mt-3 w-full rounded-md border border-dashed border-line px-2 py-2 text-xs font-medium text-muted hover:text-ink"
          >
            + Add process block
          </button>
          <div className="mt-4 rounded-md border border-line bg-bg p-2 text-[11px] leading-snug text-muted">
            Tips: drag foods/blocks from here. Connect blocks with the dots on the sides.
            Click a block to edit what happens to its nutrients.
          </div>
        </aside>

        {/* canvas */}
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(event, node) => {
              if (!(event.metaKey || event.ctrlKey || event.shiftKey)) {
                setSelectedId(node.id);
              }
            }}
            onSelectionChange={handleSelectionChange}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectionIds([]);
            }}
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={["Meta", "Control"]}
            fitView
            proOptions={{ hideAttribution: false }}
            className="bg-canvas"
          >
            <Background gap={18} size={1} color="var(--line)" />
            <Controls />
            <MiniMap pannable zoomable nodeColor="var(--accent)" className="rounded-md border border-line" />
          </ReactFlow>
        </div>

        {/* inspector */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-surface p-3">
          {!selectedNode ? (
            <div className="mt-8 text-center text-xs text-muted">
              Select a block to inspect its nutrients.
            </div>
          ) : selectedNode.type === "food" ? (
            <FoodInspector node={selectedNode} onPatch={patchNode} onRemove={removeNode} />
          ) : (
            <ProcessInspector
              node={selectedNode}
              computed={selectedProcess}
              onPatch={patchNode}
              onRemove={removeNode}
              onAskAi={askAi}
              estimating={estimating}
            />
          )}
          {preview.error && (
            <p className="mt-3 rounded-md border border-warn-line bg-warn-soft p-2 text-[11px] text-warn-ink">
              {preview.error}
            </p>
          )}
        </aside>
      </div>

      {/* bottom hint bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface px-4 py-1.5 text-[10px] text-muted">
        <span className="tabular font-medium text-ink/60">{selectionIds.length} selected</span>
        {selectionIds.length > 0 && (
          <button type="button" onClick={copySelection} className="hover:text-ink">
            Copy (Ctrl+C)
          </button>
        )}
        {internalClipboardRef.current && (
          <button type="button" onClick={pasteClipboard} className="hover:text-ink">
            Paste (Ctrl+V)
          </button>
        )}
        <span>Delete: remove</span>
        <span>Ctrl+Z: undo</span>
        <span>Ctrl+Shift+Z: redo</span>
        <span>Ctrl+C / Ctrl+V: copy / paste</span>
        <span>Ctrl+A: select all</span>
        <span>Shift-drag: box select</span>
        <span>Shift/Ctrl-click: multi-select</span>
      </div>

      {notice && (
        <div className="pointer-events-none absolute bottom-12 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-1.5 text-xs text-ink shadow-card">
          {notice}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function inputsForNode(
  nodeId: string,
  edges: Edge[],
  nodes: Node[],
  foods: Food[],
): { name: string; grams: number; kcalPer100g: number | null }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inputs: { name: string; grams: number; kcalPer100g: number | null }[] = [];
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const source = byId.get(edge.source);
    if (!source) continue;
    if (source.type === "food") {
      const d = source.data as { label?: string; foodId: string; grams: number };
      const food = foods.find((f) => f.id === d.foodId);
      inputs.push({
        name: food?.name ?? d.foodId,
        grams: d.grams,
        kcalPer100g: food?.nutrients.ENERC_KCAL.amount ?? null,
      });
    } else {
      const d = source.data as { name?: string };
      inputs.push({ name: d.name ?? "upstream step", grams: 100, kcalPer100g: null });
    }
  }
  return inputs;
}

/* ------------------------------------------------------------------ */

function FoodInspector({
  node, onPatch, onRemove,
}: {
  node: Node;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
}) {
  const d = node.data as { label: string; grams: number };
  return (
    <div>
      <h2 className="text-sm font-semibold">{d.label}</h2>
      <label className="mt-3 flex flex-col gap-1 text-xs">
        <span className="font-medium">Amount (g)</span>
        <input
          type="number"
          min={0}
          value={d.grams}
          onChange={(e) => onPatch(node.id, { grams: Math.max(0, Number(e.target.value) || 0) })}
          className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
        />
      </label>
      <p className="mt-2 text-[11px] text-muted">Nutrients are loaded from the food record.</p>
      <button type="button" onClick={() => onRemove(node.id)} className="mt-4 text-xs text-danger-ink underline">
        Remove ingredient
      </button>
    </div>
  );
}

function ProcessInspector({
  node, computed, onPatch, onRemove, onAskAi, estimating,
}: {
  node: Node;
  computed: ReturnType<typeof computeGraph>["perNode"] extends Map<string, infer V> ? V | null | undefined : never;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onAskAi: () => void;
  estimating: boolean;
}) {
  const data = node.data as unknown as {
    name: string;
    operation: string;
    qualifier: string | null;
    outputs: { label: string; tag: "consumed" | "discarded"; split: Record<string, number> }[];
    measuredOutputs: (number | null)[];
    factorEstimates: Record<string, number>;
  };
  const supportsQualifier = ["boil", "strain", "pressure-cook"].includes(data.operation);

  return (
    <div>
      <h2 className="text-sm font-semibold">Step</h2>
      <label className="mt-2 flex flex-col gap-1 text-xs">
        <span className="font-medium">Name</span>
        <input value={data.name} onChange={(e) => onPatch(node.id, { name: e.target.value })} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
      </label>
      <label className="mt-2 flex flex-col gap-1 text-xs">
        <span className="font-medium">Operation</span>
        <select value={data.operation} onChange={(e) => onPatch(node.id, { operation: e.target.value })} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
          {OPERATION_OPTIONS.map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
      </label>
      {supportsQualifier && (
        <label className="mt-2 flex flex-col gap-1 text-xs">
          <span className="font-medium">With or without water</span>
          <select value={data.qualifier ?? ""} onChange={(e) => onPatch(node.id, { qualifier: e.target.value || null })} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
            <option value="">any</option>
            <option value="drained">drained (water thrown away)</option>
            <option value="undrained">undrained (kept)</option>
          </select>
        </label>
      )}

      <div className="mt-3">
        <p className="text-xs font-medium">Outputs</p>
        {data.outputs.map((output, index) => (
          <div key={index} className="mt-1 rounded-md border border-line bg-bg p-2">
            <input
              value={output.label}
              onChange={(e) => {
                const outputs = [...data.outputs];
                outputs[index] = { ...outputs[index], label: e.target.value };
                onPatch(node.id, { outputs });
              }}
              className="w-full rounded border border-line bg-surface px-1.5 py-1 text-xs"
            />
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <div className="flex gap-1">
                <button type="button" onClick={() => { const outputs = [...data.outputs]; outputs[index] = { ...outputs[index], tag: "consumed" }; onPatch(node.id, { outputs }); }} className={`rounded px-2 py-0.5 ${output.tag === "consumed" ? "bg-accent text-accent-fg" : "border border-line text-muted"}`}>eaten</button>
                <button type="button" onClick={() => { const outputs = [...data.outputs]; outputs[index] = { ...outputs[index], tag: "discarded" }; onPatch(node.id, { outputs }); }} className={`rounded px-2 py-0.5 ${output.tag === "discarded" ? "bg-ink/20 text-ink" : "border border-line text-muted"}`}>discarded</button>
              </div>
              <input
                type="number"
                min={0}
                placeholder="weighed g"
                value={data.measuredOutputs[index] ?? ""}
                onChange={(e) => {
                  const measuredOutputs = [...data.measuredOutputs];
                  measuredOutputs[index] = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
                  onPatch(node.id, { measuredOutputs });
                }}
                className="w-24 rounded border border-line bg-surface px-1.5 py-0.5"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium">Nutrient changes</p>
        {computed && computed.factors.length > 0 ? (
          <ul className="mt-1 space-y-1 text-[11px]">
            {computed.factors.map((f) => {
              const beforeVal = computed.before.totals[f.nutrient];
              const afterVal = beforeVal != null ? beforeVal * f.factor : null;
              return (
                <li key={f.nutrient} className="flex items-baseline justify-between gap-2 rounded bg-canvas/40 px-1.5 py-1">
                  <span className="text-ink/70">{f.nutrient}</span>
                  <span className="tabular text-ink/50">
                    {beforeVal != null ? fmt(beforeVal, 1) : "?"} → {afterVal != null ? fmt(afterVal, 1) : "?"} {Math.round(f.factor * 100)}%
                    {f.source === "estimated" && <span className="ml-1 rounded bg-warn-soft px-1 text-[9px] text-warn-ink">est</span>}
                    {f.source === "table" && <span className="ml-1 rounded bg-accent/10 px-1 text-[9px] text-accent">tbl</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-muted">No change expected for this operation (or no data).</p>
        )}
        <button
          type="button"
          onClick={onAskAi}
          disabled={estimating}
          className="mt-2 w-full rounded-md border border-line px-2 py-1.5 text-[11px] font-medium disabled:opacity-50"
        >
          {estimating ? "Asking…" : "Ask AI what changes"}
        </button>
      </div>

      <button type="button" onClick={() => onRemove(node.id)} className="mt-4 text-xs text-danger-ink underline">
        Remove step
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function buildGraph(nodes: Node[], edges: Edge[]): Graph {
  const engineNodes: EngineNode[] = [];
  for (const node of nodes) {
    if (node.type === "food") {
      const d = node.data as { foodId: string; grams: number };
      engineNodes.push({ id: node.id, type: "food", foodId: d.foodId, grams: d.grams });
    } else {
      const d = node.data as unknown as {
        name: string; operation: string; qualifier: string | null;
        outputs: { label: string; tag: "consumed" | "discarded"; split: Record<string, number> }[];
        measuredOutputs: (number | null)[];
        factorEstimates: Record<string, number>;
        factorOverrides?: Record<string, number>;
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
      });
    }
  }
  return {
    nodes: engineNodes,
    edges: edges.map((e) => ({ id: String(e.id), from: e.source, to: e.target })),
  };
}

function buildInitialNodes(graph: Graph | null | undefined, layout: Record<string, { x: number; y: number }> | undefined, foods: Food[]): Node[] {
  if (!graph) return [];
  let foodIndex = 0;
  let processIndex = 0;
  const positioned = (id: string, isProcess: boolean) =>
    layout?.[id] ?? {
      x: isProcess ? 340 : 80,
      y: (isProcess ? processIndex++ : foodIndex++) * 170 + 40,
    };
  return graph.nodes.map((node): Node => {
    if (node.type === "food") {
      const food = foods.find((f) => f.id === node.foodId);
      const unknownCount = food ? Object.values(food.nutrients).filter((v) => v.amount == null).length : 0;
      return {
        id: node.id,
        type: "food",
        position: positioned(node.id, false),
        data: { label: food?.name ?? node.foodId, grams: node.grams, foodId: node.foodId, unknownCount },
      };
    }
    const d = node as GraphProcessNode;
    return {
      id: node.id,
      type: "process",
      position: positioned(node.id, true),
      data: {
        name: d.name,
        operation: d.operation,
        qualifier: d.qualifier ?? null,
        outputs: d.outputs,
        measuredOutputs: d.measuredOutputs ?? d.outputs.map(() => null),
        factorEstimates: d.factorEstimates ?? {},
        factorOverrides: d.factorOverrides ?? {},
      },
    } as Node;
  });
}

function buildInitialEdges(graph: Graph | null | undefined): Edge[] {
  if (!graph) return [];
  return graph.edges.map((e) => ({ id: e.id, source: e.from, target: e.to }));
}
