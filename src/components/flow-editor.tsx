"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
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
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { saveGraphAction, estimateNodeDeltasAction, searchUsdaAction, importUsdaAction, saveCapturedFoodAction, defaultAmountAction } from "@/app/actions";
import { searchFoods } from "@/lib/nutrition/food-search";
import { toGrams, unitsFor, parseUnitKey } from "@/lib/nutrition/units";
import { defaultAmountFor } from "@/lib/nutrition/defaults";
import { computeGraph, type Graph, type GraphNode as EngineNode, type GraphProcessNode } from "@/lib/nutrition/graph";
import type { Rollup } from "@/lib/nutrition/engine";
import { cleanNote, MAX_NOTE_LENGTH } from "@/lib/notes";
import { layoutGraph } from "@/lib/graph-layout";
import { tableFromRows, type FactorRow } from "@/lib/nutrition/factor-table";
import { fmt } from "@/lib/format";
import { NUTRIENT_CODES, NUTRIENTS } from "@/lib/nutrition/types";
import type { Food } from "@/lib/nutrition/types";
import { nodeTypes } from "@/components/flow-nodes";
import { FlowMinimap } from "@/components/flow-minimap";
import { PasteFragmentDialog } from "@/components/paste-fragment-dialog";
import { RecipeGenerator } from "@/components/recipe-generator";
import { useLeaveGuard, LeaveGuardDialog } from "@/components/leave-guard";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { serializeFragment, parseRecipeFragment } from "@/lib/recipe-fragment";
import { HandIcon, BoxSelectIcon } from "@/components/icons";

const OPERATION_OPTIONS = [
  "assemble", "mix", "boil", "pressure-cook", "steam", "sauté", "fry", "deep-fry",
  "roast", "bake", "grill", "blend", "strain", "reduce", "cool", "refrigerate",
  "freeze", "marinate", "ferment", "wash", "soak", "grate", "dice", "slice", "chop",
];

export interface FlowEditorProps {
  foods: Food[];
  factorRows: FactorRow[];
  ai?: { enabled: boolean; hasKey: boolean };
  recipeId: string | null;
  initialGraph?: Graph | null;
  initialLayout?: Record<string, { x: number; y: number }>;
  initialName?: string;
  initialInstructions?: string;
  initialServings?: string;
  initialVersionLabel?: string;
  /** The version being edited. Set only on the edit screen. */
  versionId?: string | null;
  versionNo?: number | null;
  /** When set, "replace this version" is refused and the reason is shown. */
  replaceBlockedReason?: string | null;
  /** Create/Edit with AI entry point, rendered in the top bar. */
  aiAction?: {
    enabled: boolean;
    mode: "create" | "edit";
    existingName?: string | null;
  } | null;
}

export function FlowEditor(props: FlowEditorProps) {
  const aiAvailable = !!props.ai?.enabled && !!props.ai?.hasKey;
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} aiAvailable={aiAvailable} />
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
  versionId = null,
  versionNo = null,
  replaceBlockedReason = null,
  aiAction = null,
  aiAvailable,
}: FlowEditorProps & { aiAvailable: boolean }) {
  const [saveMode, setSaveMode] = useState<"new-version" | "replace-current">("new-version");
  const replaceVersionId = saveMode === "replace-current" ? versionId : null;
  const saveLabel =
    versionId == null
      ? "Save recipe"
      : saveMode === "replace-current"
        ? `Replace v${versionNo ?? ""}`
        : "Save as new version";
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [versionLabel, setVersionLabel] = useState(initialVersionLabel);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [servings, setServings] = useState(initialServings);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [paletteCategory, setPaletteCategory] = useState("All");
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [usdaQuery, setUsdaQuery] = useState("");
  const [usdaResults, setUsdaResults] = useState<{ fdcId: number; name: string; category?: string; nutrients: number }[]>([]);
  const [usdaSearching, setUsdaSearching] = useState(false);
  const [library, setLibrary] = useState(foods);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasteOffset, setPasteOffset] = useState(0);
  const [canvasMode, setCanvasMode] = useState<"pan" | "select">("pan");
  /* Below lg the library/inspector asides would eat 544px of a
     phone-width screen (w-56 + w-80 shrink-0) and leave the canvas
     nothing. They become toggleable overlays there instead. */
  const [mobilePanel, setMobilePanel] = useState<null | "library" | "inspector">(null);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [internalFragment, setInternalFragment] = useState<string | null>(null);
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
    (foodId: string) => library.find((f) => f.id === foodId)?.nutrients ?? (() => { throw new Error("unknown food"); })(),
    [library],
  );

  const graph = useMemo<Graph>(() => buildGraph(nodes, edges), [nodes, edges]);

  // Baseline for the leave guard: what the workspace looked like on open.
  const [baseline] = useState(() =>
    JSON.stringify({
      meta: [initialName, initialVersionLabel, initialInstructions, initialServings],
      graph: buildGraph(
        buildInitialNodes(initialGraph, initialLayout, foods),
        buildInitialEdges(initialGraph),
      ),
      positions: buildInitialNodes(initialGraph, initialLayout, foods).map((n) => [
        Math.round(n.position.x),
        Math.round(n.position.y),
      ]),
    }),
  );
  const dirty = useMemo(
    () =>
      baseline !==
      JSON.stringify({
        meta: [name, versionLabel, instructions, servings],
        graph,
        positions: nodes.map((n) => [Math.round(n.position.x), Math.round(n.position.y)]),
      }),
    [baseline, name, versionLabel, instructions, servings, graph, nodes],
  );
  const preview = useMemo(() => {
    try {
      return { result: computeGraph(graph, resolve, { factorTable }), error: null as string | null };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : "Could not compute." };
    }
  }, [graph, resolve, factorTable]);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedInputLinks = useMemo(
    () =>
      selectedNode?.type === "process"
        ? inputsForNode(selectedNode.id, edges, nodes, library)
        : [],
    [selectedNode, edges, nodes, library],
  );
  const selectedProcess = preview.result?.perNode.get(selectedId ?? "") ?? null;

  async function addFood(food: Food) {
    // The stored layers (pin, last-used) live on the server; the food's
    // own data and the rules answer instantly as the fallback.
    const fallback = defaultAmountFor(food);
    let chosen: { amount: number; unit: string } = fallback;
    const resolved = await defaultAmountAction(food.id);
    if (resolved.ok && resolved.amount != null && resolved.unit) {
      chosen = { amount: resolved.amount, unit: resolved.unit };
    }
    const parsed = parseUnitKey(chosen.unit);
    const converted = toGrams(food, {
      amount: chosen.amount,
      unit: parsed.unit,
      portionLabel: parsed.portionLabel,
    });

    const id = crypto.randomUUID();
    const foodNode: Node = {
      id,
      type: "food",
      position: { x: 80 + Math.random() * 120, y: 80 + Math.random() * 160 },
      data: {
        label: food.name,
        grams: converted.ok ? converted.grams : chosen.amount,
        amount: chosen.amount,
        unit: chosen.unit,
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
      setEdges((edges) => [...edges, { id: crypto.randomUUID(), source: id, target: target.id, animated: true, style: { stroke: "var(--accent)", strokeWidth: 2.25 }, markerEnd: { type: "arrowclosed", color: "var(--accent)" } }]);
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
    const next = [...current, processNode];
    nodesRef.current = next;
    setNodes(next);
    flashNotice(
      "Step added. Select it, then add a food to connect them — or drag from an ingredient's output dot.",
    );
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
  const onClickConnectStart = useCallback(
    (_event: unknown, params: { nodeId: string | null; handleType: "source" | "target" | null }) => {
      if (!params.nodeId || !params.handleType) return;
      flashNotice(params.handleType === "source" ? "Now tap an input dot on a step." : "Now tap the output dot on an ingredient.");
    },
    [],
  );

  const onClickConnectEnd = useCallback(() => {
    flashNotice("Connected.");
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), animated: true, style: { stroke: "var(--accent)", strokeWidth: 2.25 }, markerEnd: { type: "arrowclosed", color: "var(--accent)" } }, current)),
    [],
  );

  function autoLayout() {
    setNodes((current) => {
      const positions = layoutGraph(
        current.map((n) => ({
          id: n.id,
          type: n.type as string,
          note: cleanNote((n.data as { note?: unknown }).note) ?? null,
        })),
        edges.map((e) => ({ from: e.source, to: e.target })),
      );
      return current.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n));
    });
  }

  async function runUsdaSearch() {
    if (!usdaQuery.trim() || usdaSearching) return;
    setUsdaSearching(true);
    try {
      const result = await searchUsdaAction(usdaQuery.trim());
      setUsdaResults(result.ok ? (result.results ?? []) : []);
      if (!result.ok) setError(result.message ?? "Search failed.");
    } finally {
      setUsdaSearching(false);
    }
  }

  async function importUsdaAndAdd(fdcId: number) {
    const result = await importUsdaAction(fdcId);
    if (!result.ok || !result.proposal) {
      setError(result.message ?? "Could not import that food.");
      return;
    }
    const proposal = result.proposal as {
      name: string;
      aliases?: string[];
      category?: string;
      kind?: string;
      state?: string;
      basis?: string;
      servingSizeG?: number;
      nutrients: Record<string, number>;
      sourceCode?: string;
    };
    const saved = await saveCapturedFoodAction({
      name: proposal.name,
      aliases: proposal.aliases,
      category: proposal.category,
      kind: (proposal.kind as never) ?? "branded",
      state: "raw",
      basis: (proposal.basis as never) ?? "per_100g",
      servingSizeG: proposal.servingSizeG,
      source: "usda",
      sourceCode: String(fdcId),
      nutrients: proposal.nutrients,
    });
    if (!saved.ok || !saved.foodId) {
      setError(saved.message ?? "Could not create that food.");
      return;
    }
    // Refresh local library so the node can resolve nutrients immediately
    const newFood: Food = {
      id: saved.foodId,
      name: proposal.name,
      aliases: proposal.aliases ?? [],
      category: proposal.category ?? "Custom",
      kind: (proposal.kind as never) ?? "branded",
      state: "raw",
      portions: [],
      nutrients: Object.fromEntries(
        Object.entries(proposal.nutrients).map(([code, amount]) => [
          code,
          { amount, status: "known" as const, source: "usda" },
        ]),
      ) as Food["nutrients"],
      source: "usda",
    };
    setLibrary((current) => [...current, newFood]);
    const resolvedDefault = await defaultAmountAction(saved.foodId);
    const amount =
      resolvedDefault.ok && resolvedDefault.amount != null ? resolvedDefault.amount : 100;
    const unit = resolvedDefault.ok && resolvedDefault.unit ? resolvedDefault.unit : "g";
    const parsed = parseUnitKey(unit);
    const converted = toGrams(newFood, {
      amount,
      unit: parsed.unit,
      portionLabel: parsed.portionLabel,
    });
    const id = crypto.randomUUID();
    setNodes((current) => [
      ...current,
      {
        id,
        type: "food",
        position: { x: 80 + Math.random() * 120, y: 100 + Math.random() * 220 },
        data: {
          label: proposal.name,
          grams: converted.ok ? converted.grams : amount,
          amount,
          unit,
          foodId: saved.foodId,
          unknownCount: 0,
        },
      },
    ]);
    setSelectedId(id);
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
    const json = serializeFragment(nodesRef.current, edges, ids);
    if (!json) {
      flashNotice("Select a block first.");
      return;
    }
    try {
      navigator.clipboard?.writeText(json).catch(() => {});
    } catch {
      /* clipboard unavailable; keep internal copy */
    }
    setInternalFragment(json);
    const count = (JSON.parse(json) as { nodes: unknown[] }).nodes.length;
    flashNotice(`Copied ${count} block${count === 1 ? "" : "s"} as JSON.`);
  }

  function pasteClipboard() {
    if (internalFragment) {
      applyFragment(internalFragment);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      navigator.clipboard
        .readText()
        .then((text) => applyFragment(text))
        .catch(() => flashNotice("Nothing to paste."));
    } else {
      flashNotice("Nothing to paste.");
    }
  }

  /** Parse, validate and insert a fragment JSON string. */
  function applyFragment(raw: string): boolean {
    const parsed = parseRecipeFragment(raw);
    if (!parsed.ok) {
      flashNotice(parsed.error);
      return false;
    }
    const fragment = parsed.fragment;
    const idMap = new Map<string, string>();
    for (const node of fragment.nodes) idMap.set(node.id, crypto.randomUUID());

    const offset = 40 * (pasteOffset + 1);
    setPasteOffset((n) => n + 1);

    const pastedNodes: Node[] = fragment.nodes.map((node) => {
      const data = node.data as Record<string, unknown>;
      if (node.type === "food") {
        const foodId = String(data.foodId);
        const food = library.find((f) => f.id === foodId);
        const label = (typeof data.label === "string" && data.label) || food?.name || foodId;
        const unknownCount = food ? Object.values(food.nutrients).filter((v) => v.amount == null).length : 0;

        // An explicit quantity (copied from a canvas node or a rich
        // fragment) travels as-is; a bare foodId gets the food's own
        // default rather than a hardcoded 100 g.
        let amount: number;
        let unit: string;
        let grams: number;
        if (typeof data.amount === "number" && typeof data.unit === "string") {
          amount = data.amount;
          unit = data.unit;
          grams = typeof data.grams === "number" ? data.grams : Number(data.grams) || amount;
        } else if (food) {
          const chosen = defaultAmountFor(food);
          amount = chosen.amount;
          unit = chosen.unit;
          const parsed = parseUnitKey(unit);
          const converted = toGrams(food, {
            amount,
            unit: parsed.unit,
            portionLabel: parsed.portionLabel,
          });
          grams = converted.ok ? converted.grams : amount;
        } else {
          grams = typeof data.grams === "number" ? data.grams : Number(data.grams) || 0;
          amount = grams;
          unit = "g";
        }

        return {
          id: idMap.get(node.id)!,
          type: "food",
          position: { x: node.position.x + offset, y: node.position.y + offset },
          selected: true,
          data: {
            foodId,
            grams,
            amount,
            unit,
            label,
            unknownCount,
            note: cleanNote(data.note) ?? null,
          },
        };
      }
      return {
        id: idMap.get(node.id)!,
        type: "process",
        position: { x: node.position.x + offset, y: node.position.y + offset },
        selected: true,
        data: {
          name: typeof data.name === "string" ? data.name : "Step",
          operation: typeof data.operation === "string" ? data.operation : "custom",
          qualifier: (data.qualifier as string | null) ?? null,
          outputs: (data.outputs as never[]) ?? [],
          measuredOutputs: (data.measuredOutputs as (number | null)[]) ?? [],
          factorEstimates: (data.factorEstimates as Record<string, number>) ?? {},
          factorOverrides: (data.factorOverrides as Record<string, number>) ?? {},
          note: cleanNote(data.note) ?? null,
        },
      } as Node;
    });

    const pastedEdges: Edge[] = fragment.edges.map((edge) => ({
      id: crypto.randomUUID(),
      source: idMap.get(edge.from)!,
      target: idMap.get(edge.to)!,
      animated: true,
      style: { stroke: "var(--accent)", strokeWidth: 2.25 },
      markerEnd: { type: "arrowclosed", color: "var(--accent)" },
    }));

    setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), ...pastedNodes]);
    setEdges((current) => [...current, ...pastedEdges]);
    const pastedIds = pastedNodes.map((n) => n.id);
    selectionRef.current = pastedIds;
    setSelectionIds(pastedIds);
    setSelectedId(null);
    flashNotice(`Pasted ${pastedNodes.length} block${pastedNodes.length === 1 ? "" : "s"}.`);
    return true;
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
        inputs: inputsForNode(selectedNode.id, edges, nodes, library),
        // The step's saved note doubles as context for the estimate — it
        // describes what actually happened in the pan.
        note: cleanNote(selectedNode.data.note),
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

  /** Save the current workspace. Resolve with the outcome. */
  function save(): Promise<{ ok: boolean; recipeId?: string }> {
    setError(null);
    if (!name.trim()) { setError("Give the recipe a name."); return Promise.resolve({ ok: false }); }
    const servingsNum = Number(servings);
    if (!Number.isFinite(servingsNum) || servingsNum <= 0) { setError("Servings must be positive."); return Promise.resolve({ ok: false }); }
    if (preview.error) { setError(preview.error); return Promise.resolve({ ok: false }); }

    const layout: Record<string, { x: number; y: number }> = {};
    for (const node of nodes) layout[node.id] = { x: node.position.x, y: node.position.y };

    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await saveGraphAction({
          recipeId,
          name,
          versionLabel: versionLabel || null,
          instructions,
          servings: servingsNum,
          layout,
          graph,
          mode: versionId ? saveMode : "new-version",
          replaceVersionId,
        });
        if (!result.ok) { setError(result.message ?? "Save failed."); resolve({ ok: false }); return; }
        resolve({ ok: true, recipeId: result.recipeId });
      });
    });
  }

  function onSave() {
    save().then((result) => {
      if (!result.ok) return;
      router.push(`/recipes/${result.recipeId}`);
      router.refresh();
    });
  }

  const leaveGuard = useLeaveGuard({ dirty, save: () => save().then((r) => r.ok) });

  const paletteCategories = useMemo(() => {
    const set = new Set(library.map((f) => f.category));
    return ["All", ...Array.from(set).filter((c) => c !== "All").sort()];
  }, [library]);

  const paletteFiltered = useMemo(() => {
    let list = searchFoods(library, query);
    if (paletteCategory !== "All") list = list.filter((f) => f.category === paletteCategory);
    if (mineOnly) {
      list = list.filter(
        (f) =>
          !!f.source &&
          f.source !== "USDA FDC SR Legacy (seed)" &&
          f.source !== "IFCT 2017 (seed, unverified)",
      );
    }
    return list.slice(0, 8);
  }, [library, query, paletteCategory, mineOnly]);

  return (
    <div className="relative flex h-[calc(100vh-57px)] flex-col">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        {/* Mobile-only panel toggles — the asides hide below lg. */}
        <button
          type="button"
          onClick={() => setMobilePanel((current) => (current === "library" ? null : "library"))}
          aria-pressed={mobilePanel === "library"}
          className="rounded-md border border-line bg-bg px-3 py-2 text-xs font-medium text-muted hover:text-ink lg:hidden"
        >
          Foods
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel((current) => (current === "inspector" ? null : "inspector"))}
          aria-pressed={mobilePanel === "inspector"}
          className="rounded-md border border-line bg-bg px-3 py-2 text-xs font-medium text-muted hover:text-ink lg:hidden"
        >
          Details
        </button>
        {aiAction && (
          <RecipeGenerator
            aiEnabled={aiAction.enabled}
            mode={aiAction.mode}
            recipeId={recipeId}
            versionId={versionId}
            versionNo={versionNo}
            existingName={aiAction.existingName ?? null}
            saveMode={saveMode}
            replaceBlockedReason={replaceBlockedReason}
          />
        )}
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
        {versionId != null && (
          <div
            role="group"
            aria-label="Where to save"
            className="flex h-9 items-center gap-0.5 rounded-lg bg-ink/[0.06] p-0.5 text-[11px]"
          >
            <button
              type="button"
              onClick={() => setSaveMode("new-version")}
              aria-pressed={saveMode === "new-version"}
              title={`Keep v${versionNo ?? ""} untouched; your changes become the next version`}
              className={`rounded-md px-2.5 py-1.5 font-medium transition ${
                saveMode === "new-version"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              New version
            </button>
            <button
              type="button"
              onClick={() => setSaveMode("replace-current")}
              aria-pressed={saveMode === "replace-current"}
              disabled={!!replaceBlockedReason}
              title={
                replaceBlockedReason ??
                `Rewrite v${versionNo ?? ""} in place. Plans and diary entries pinned to it will see the new values.`
              }
              className={`rounded-md px-2.5 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                saveMode === "replace-current"
                  ? "bg-surface text-danger-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Replace v{versionNo}
            </button>
          </div>
        )}
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
          {pending ? "Saving…" : saveLabel}
        </button>
      </div>

      {versionId != null && saveMode === "replace-current" && (
        <div className="border-b border-warn-line bg-warn-soft px-4 py-1.5 text-[11px] text-warn-ink">
          This replaces v{versionNo} in place — plans or diary entries pinned to v{versionNo}{" "}
          will see the new values. There is no automatic undo.
        </div>
      )}
      {error && (
        <div className="border-b border-danger-line bg-danger-soft px-4 py-1.5 text-xs text-danger-ink">
          {error}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* palette */}
        <aside
          className={`w-64 shrink-0 overflow-y-auto border-r border-line bg-surface p-3 lg:block lg:w-56 ${
            mobilePanel === "library"
              ? "absolute inset-y-0 left-0 z-30 shadow-2xl"
              : "hidden"
          }`}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search foods…"
            aria-label="Search foods"
            className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-xs"
          />
          <div className="mt-2 flex items-center gap-1.5">
            <select
              value={paletteCategory}
              onChange={(e) => setPaletteCategory(e.target.value)}
              aria-label="Filter by category"
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-bg px-1 text-[11px] text-muted"
            >
              {paletteCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label className="flex h-7 shrink-0 cursor-pointer items-center gap-1 text-[10px] text-muted">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              My foods
            </label>
          </div>
          <ul className="mt-2 max-h-44 space-y-0.5 overflow-auto">
            {paletteFiltered.map((food) => (
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
          <div className="mt-3 border-t border-line pt-3">
            <label className="flex flex-col gap-1 text-[11px]">
              <span className="font-medium text-ink/60">Search the USDA database</span>
              <div className="flex gap-1">
                <input
                  value={usdaQuery}
                  onChange={(e) => setUsdaQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runUsdaSearch()}
                  placeholder="moong dal, sprouts, paneer…"
                  aria-label="Search USDA database"
                  className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={runUsdaSearch}
                  disabled={usdaSearching || !usdaQuery.trim()}
                  className="rounded-md border border-line px-2 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {usdaSearching ? "…" : "Go"}
                </button>
              </div>
            </label>
            {usdaResults.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto">
                {usdaResults.map((r) => (
                  <li key={r.fdcId}>
                    <button
                      type="button"
                      onClick={() => importUsdaAndAdd(r.fdcId)}
                      className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-ink/5"
                    >
                      <span className="truncate">{r.name}</span>
                      <span className="shrink-0 text-[10px] text-muted">import</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={addProcess}
            className="mt-3 w-full rounded-md border border-dashed border-line px-2 py-2 text-xs font-medium text-muted hover:text-ink"
          >
            + Add process block
          </button>
          <div className="mt-4 rounded-md border border-line bg-bg p-2 text-[11px] leading-snug text-muted">
            Tips: drag foods/blocks from here, or add them with the buttons. Connect blocks
            with the dots on the sides — or select a step, then add a food, and it connects
            to that step. Click a block to edit what happens to its nutrients.
          </div>
        </aside>

        {/* canvas */}
        <div className="relative min-w-0 flex-1">
          <div
            role="group"
            aria-label="Canvas mode"
            className="absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface/90 p-0.5 shadow-card backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={() => setCanvasMode("pan")}
              aria-pressed={canvasMode === "pan"}
              title="Move the canvas (drag to pan)"
              aria-label="Move the canvas"
              className={`grid h-8 w-8 place-items-center rounded-md transition ${
                canvasMode === "pan" ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"
              }`}
            >
              <HandIcon width={15} height={15} />
            </button>
            <button
              type="button"
              onClick={() => setCanvasMode("select")}
              aria-pressed={canvasMode === "select"}
              title="Select blocks (drag a box, like files on a desktop)"
              aria-label="Select blocks with a box"
              className={`grid h-8 w-8 place-items-center rounded-md transition ${
                canvasMode === "select" ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"
              }`}
            >
              <BoxSelectIcon width={15} height={15} />
            </button>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onClickConnectStart={onClickConnectStart}
            onClickConnectEnd={onClickConnectEnd}
            onNodeClick={(event, node) => {
              if (!(event.metaKey || event.ctrlKey || event.shiftKey)) {
                setSelectedEdgeId(null);
                setSelectedId(node.id);
              }
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedId(null);
              setSelectionIds([edge.source, edge.target]);
            }}
            onSelectionChange={handleSelectionChange}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectionIds([]);
            }}
            deleteKeyCode={null}
            panOnDrag={canvasMode === "pan"}
            selectionOnDrag={canvasMode === "select"}
            selectionMode={SelectionMode.Partial}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={["Meta", "Control"]}
            fitView
            proOptions={{ hideAttribution: false }}
            className="bg-canvas"
          >
            <Background gap={18} size={1} color="var(--line)" />
            <Controls />
            <FlowMinimap nodes={nodes} />
          </ReactFlow>
        </div>

        {/* inspector */}
        <aside
          className={`w-72 shrink-0 overflow-y-auto border-l border-line bg-surface p-3 lg:block lg:w-80 ${
            mobilePanel === "inspector"
              ? "absolute inset-y-0 right-0 z-30 shadow-2xl"
              : "hidden"
          }`}
        >
          {selectedEdgeId ? (
            <ConnectionInspector
              edgeId={selectedEdgeId}
              nodes={nodes}
              edges={edges}
              onDisconnect={() => {
                setEdges((current) => current.filter((e) => e.id !== selectedEdgeId));
                setSelectedEdgeId(null);
              }}
            />
          ) : !selectedNode ? (
            <div className="mt-8 text-center text-xs text-muted">
              Select a block to inspect its nutrients, or a connection to disconnect it.
            </div>
          ) : selectedNode.type === "food" ? (
            <FoodInspector node={selectedNode} onPatch={patchNode} onRemove={removeNode} foods={library} />
          ) : (
            <ProcessInspector
              node={selectedNode}
              computed={selectedProcess}
              onPatch={patchNode}
              onRemove={removeNode}
              onAskAi={askAi}
              estimating={estimating}
              aiAvailable={aiAvailable}
              inputLinks={selectedInputLinks}
              isTerminal={selectedNode ? !edges.some((edge) => edge.source === selectedNode.id) : false}
            />
          )}
          {preview.error && (
            <p className="mt-3 rounded-md border border-warn-line bg-warn-soft p-2 text-[11px] text-warn-ink">
              {preview.error}
            </p>
          )}
        </aside>

        {/* Mobile backdrop: click to dismiss an open overlay panel.
            On lg+ the asides are static, so this never renders there. */}
        {mobilePanel && (
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setMobilePanel(null)}
            className="absolute inset-0 z-20 bg-ink/30 lg:hidden"
          />
        )}
      </div>

      {/* bottom hint bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface px-4 py-1.5 text-[10px] text-muted">
        <span className="tabular font-medium text-ink/60">{selectionIds.length} selected</span>
        {selectionIds.length > 0 && (
          <button type="button" onClick={copySelection} className="hover:text-ink">
            Copy (Ctrl+C)
          </button>
        )}
        {internalFragment && (
          <button type="button" onClick={pasteClipboard} className="hover:text-ink">
            Paste (Ctrl+V)
          </button>
        )}
        <button type="button" onClick={() => setPasteDialogOpen(true)} className="hover:text-ink">
          Paste JSON…
        </button>
        <span>Delete: remove</span>
        <span>Ctrl+Z: undo</span>
        <span>Ctrl+Shift+Z: redo</span>
        <span>Ctrl+C / Ctrl+V: copy / paste</span>
        <span>Ctrl+A: select all</span>
        <span>{canvasMode === "select" ? "Drag: box select" : "Drag: move canvas"}</span>
        <span>Shift/Ctrl-click: multi-select</span>
      </div>

      {notice && (
        <div className="pointer-events-none absolute bottom-12 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-1.5 text-xs text-ink shadow-card">
          {notice}
        </div>
      )}

      <PasteFragmentDialog
        open={pasteDialogOpen}
        onClose={() => setPasteDialogOpen(false)}
        onInsert={applyFragment}
      />
      <LeaveGuardDialog
        open={leaveGuard.open}
        busy={leaveGuard.busy}
        leaveError={leaveGuard.leaveError}
        heading={leaveGuard.heading}
        onStay={leaveGuard.stay}
        onDiscard={leaveGuard.discard}
        onSaveAndLeave={leaveGuard.saveAndLeave}
      />
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
  node, onPatch, onRemove, foods,
}: {
  node: Node;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  foods: Food[];
}) {
  const d = node.data as { label: string; grams: number; amount?: number | null; unit?: string | null; foodId: string; note?: string | null };
  const food = foods.find((f) => f.id === d.foodId);
  const amount = d.amount ?? d.grams;
  const unitKey = d.unit ?? "g";
  const parsed = parseUnitKey(unitKey);
  const preview = food ? toGrams(food, { amount: Number(amount) || 0, unit: parsed.unit, portionLabel: parsed.portionLabel }) : null;
  const resolved = preview?.ok ? preview.grams : d.grams;
  const [showAll, setShowAll] = useState(false);
  const isUsda = food?.source === "usda" || food?.source === "openfoodfacts";
  return (
    <div>
      <h2 className="font-display text-sm font-semibold tracking-tight text-ink">{d.label}</h2>
      {food?.source && (
        <p className="mt-0.5 text-[11px] text-muted">
          {isUsda ? `Imported from ${food.source === "usda" ? "USDA FoodData Central" : "Open Food Facts"}` : `Source: ${food.source}`}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-1 text-xs">
        <span className="font-medium">Amount</span>
        <div className="flex items-stretch gap-1.5">
          <input
            type="number"
            min={0}
            step="any"
            value={amount}
            aria-label="Quantity"
            onChange={(e) => {
              const nextAmount = Math.max(0, Number(e.target.value) || 0);
              const next = food ? toGrams(food, { amount: nextAmount, unit: parsed.unit, portionLabel: parsed.portionLabel }) : null;
              onPatch(node.id, {
                amount: nextAmount,
                grams: next?.ok ? next.grams : nextAmount,
              });
            }}
            className="w-24 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
          />
          <select
            value={unitKey}
            aria-label="Unit"
            onChange={(e) => {
              const nextKey = e.target.value;
              const parsedKey = parseUnitKey(nextKey);
              const next = food ? toGrams(food, { amount: Number(amount) || 0, unit: parsedKey.unit, portionLabel: parsedKey.portionLabel }) : null;
              onPatch(node.id, {
                unit: nextKey,
                grams: next?.ok ? next.grams : Number(amount) || 0,
              });
            }}
            className="max-w-[130px] rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
          >
            {food ? (
              unitsFor(food).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            ) : (
              <option value="g">g</option>
            )}
          </select>
        </div>
        <p className="text-[10px] text-ink/45">
          = <span className="tabular font-medium text-ink/65">{fmt(resolved, 0)} g</span>
          {preview && !preview.ok && (
            <span className="ml-1 text-warn-ink">· {preview.reason}</span>
          )}
          {preview?.ok && preview.note && (
            <span className="ml-1 text-warn-ink">· {preview.note}</span>
          )}
        </p>
      </div>

      {food && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
          >
            <span className={`transition-transform ${showAll ? "rotate-90" : ""}`}>▸</span>
            Nutrients per 100 g{food.nutrients && Object.values(food.nutrients).some((v) => v?.amount == null) ? " (some unknown)" : ""}
          </button>
          {showAll && (
            <ul className="mt-2 divide-y divide-line border-t border-line text-xs">
              {NUTRIENT_CODES.map((code) => {
                const v = food.nutrients[code];
                const meta = NUTRIENTS[code];
                const unknown = v?.amount == null;
                return (
                  <li key={code} className="flex items-baseline justify-between gap-2 py-1.5">
                    <span className="text-ink/70">{meta.label}</span>
                    <span className="tabular text-ink/55">
                      {unknown ? <span className="text-ink/30">unknown</span> : `${fmt(v.amount!, meta.precision)} ${meta.unit}`}
                      {v?.status === "estimated" && <span className="ml-1 rounded bg-warn-soft px-1 text-[9px] text-warn-ink">est</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {!food && (
        <p className="mt-3 rounded-md border border-warn-line bg-warn-soft p-2 text-[11px] text-warn-ink">
          This food is not in your library — its nutrients are not available. Re-add it from the palette.
        </p>
      )}

      {/* ---------------- Note ---------------- */}
      <label className="mt-4 flex flex-col gap-1 text-xs">
        <span className="flex items-baseline justify-between font-medium">
          <span>Note (optional)</span>
          {(d.note?.length ?? 0) > MAX_NOTE_LENGTH * 0.8 && (
            <span className="tabular text-[10px] text-ink/35">
              {d.note?.length}/{MAX_NOTE_LENGTH}
            </span>
          )}
        </span>
        <textarea
          value={d.note ?? ""}
          onChange={(e) => onPatch(node.id, { note: e.target.value })}
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="e.g. Pat dry before searing."
          className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
        />
        <span className="text-[10px] text-ink/40">
          Prep or handling detail for this ingredient. Optional — leave it empty if there is nothing worth
          noting.
        </span>
      </label>

      <button type="button" onClick={() => onRemove(node.id)} className="mt-4 text-xs text-danger-ink underline">
        Remove ingredient
      </button>
    </div>
  );
}

interface InputLink {
  name: string;
  grams: number;
  kcalPer100g: number | null;
}

function ProcessInspector({
  node,
  computed,
  onPatch,
  onRemove,
  onAskAi,
  estimating,
  aiAvailable,
  inputLinks,
  isTerminal,
}: {
  node: Node;
  computed: ReturnType<typeof computeGraph>["perNode"] extends Map<string, infer V> ? V | null | undefined : never;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onRemove: (id: string) => void;
  onAskAi: () => void;
  estimating: boolean;
  aiAvailable: boolean;
  inputLinks: InputLink[];
  isTerminal: boolean;
}) {
  const data = node.data as unknown as {
    name: string;
    operation: string;
    qualifier: string | null;
    outputs: { label: string; tag: "consumed" | "discarded"; split: Record<string, number> }[];
    measuredOutputs: (number | null)[];
    factorEstimates: Record<string, number>;
    note?: string | null;
  };
  const supportsQualifier = ["boil", "strain", "pressure-cook"].includes(data.operation);
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <div>
      <h2 className="font-display text-sm font-semibold tracking-tight text-ink">{data.name.trim() || "Step"}</h2>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-ink/40">
        {isTerminal ? "Final step" : "Process"} · {data.operation}
      </p>

      <label className="mt-2 flex flex-col gap-1 text-xs">
        <span className="font-medium">Name</span>
        <input value={data.name} onChange={(e) => onPatch(node.id, { name: e.target.value })} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm" />
      </label>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Operation</span>
          <select value={data.operation} onChange={(e) => onPatch(node.id, { operation: e.target.value })} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
            {OPERATION_OPTIONS.map((op) => <option key={op} value={op}>{op}</option>)}
          </select>
        </label>
        {supportsQualifier && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Water</span>
            <select value={data.qualifier ?? ""} onChange={(e) => onPatch(node.id, { qualifier: e.target.value || null })} className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm">
              <option value="">any</option>
              <option value="drained">drained</option>
              <option value="undrained">kept</option>
            </select>
          </label>
        )}
      </div>

      {/* ---------------- Note ---------------- */}
      <label className="mt-3 flex flex-col gap-1 text-xs">
        <span className="flex items-baseline justify-between font-medium">
          <span>Note (optional)</span>
          {(data.note?.length ?? 0) > MAX_NOTE_LENGTH * 0.8 && (
            <span className="tabular text-[10px] text-ink/35">
              {data.note?.length}/{MAX_NOTE_LENGTH}
            </span>
          )}
        </span>
        <textarea
          value={data.note ?? ""}
          onChange={(e) => onPatch(node.id, { note: e.target.value })}
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="e.g. Whip until the batter falls in a ribbon."
          className="rounded-md border border-line bg-bg px-2 py-1.5 text-sm"
        />
        <span className="text-[10px] text-ink/40">
          Technique, consistency or doneness hints — not a step of its own. Saved with the recipe, and the AI
          reads and writes it too.
        </span>
      </label>

      {/* ---------------- Inputs ---------------- */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/45">Inputs</p>
          <span className="text-[10px] tabular text-ink/35">{inputLinks.length}</span>
        </div>
        {inputLinks.length === 0 ? (
          <p className="mt-1.5 rounded-md border border-dashed border-line px-2 py-2 text-[11px] text-muted">
            Nothing connected yet. Add a food from the library while this step is selected, or
            drag from an ingredient's output dot.
          </p>
        ) : (
          <ul className="mt-1.5 divide-y divide-line/60 rounded-md border border-line/60 bg-bg">
            {inputLinks.map((link) => (
              <li key={link.name} className="flex items-baseline justify-between gap-2 px-2 py-1.5 text-xs">
                <span className="truncate">{link.name}</span>
                <span className="tabular flex shrink-0 items-baseline gap-2 text-[11px] text-ink/50">
                  <span>{Math.round(link.grams)} g</span>
                  <span className="text-ink/30">·</span>
                  <span>
                    {link.kcalPer100g != null ? `${Math.round((link.kcalPer100g * link.grams) / 100)} kcal` : "? kcal"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------------- Outputs ---------------- */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/45">Outputs</p>
          <span className="text-[10px] tabular text-ink/35">
            {isTerminal ? "goes to the plate" : "goes to the next step"}
          </span>
        </div>
        {data.outputs.map((output, index) => (
          <div key={index} className="mt-1.5 rounded-md border border-line bg-bg p-2">
            <div className="flex items-center gap-2">
              <input
                value={output.label}
                onChange={(e) => {
                  const outputs = [...data.outputs];
                  outputs[index] = { ...outputs[index], label: e.target.value };
                  onPatch(node.id, { outputs });
                }}
                aria-label="Output name"
                className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-xs"
              />
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const outputs = [...data.outputs];
                    outputs[index] = { ...outputs[index], tag: "consumed" };
                    onPatch(node.id, { outputs });
                  }}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${output.tag === "consumed" ? "bg-accent text-accent-fg" : "border border-line text-muted"}`}
                >
                  eaten
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const outputs = [...data.outputs];
                    outputs[index] = { ...outputs[index], tag: "discarded" };
                    onPatch(node.id, { outputs });
                  }}
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${output.tag === "discarded" ? "bg-ink/20 text-ink" : "border border-line text-muted"}`}
                >
                  discarded
                </button>
              </div>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
              <span>weighed output</span>
              <input
                type="number"
                min={0}
                placeholder="g"
                value={data.measuredOutputs[index] ?? ""}
                onChange={(e) => {
                  const measuredOutputs = [...data.measuredOutputs];
                  measuredOutputs[index] = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
                  onPatch(node.id, { measuredOutputs });
                }}
                className="w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px]"
              />
              <span>g</span>
            </div>
          </div>
        ))}
        {isTerminal && data.outputs.length === 1 && data.outputs[0].label === "Output" && (
          <button
            type="button"
            onClick={() => {
              const outputs = [...data.outputs];
              outputs[0] = { ...outputs[0], label: "Final product" };
              onPatch(node.id, { outputs });
            }}
            className="mt-1.5 rounded-md border border-dashed border-accent/40 bg-accent/5 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/10"
          >
            Name it “Final product”
          </button>
        )}
      </div>

      {/* ---------------- Nutrient changes ---------------- */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/45">Nutrients</p>
          {computed && computed.inputGrams > 0 && (
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="text-[10px] font-medium text-accent hover:underline"
            >
              All 18 →
            </button>
          )}
        </div>

        {!computed || computed.inputGrams === 0 ? (
          <p className="mt-1 text-[10px] text-muted">Nothing flows in yet.</p>
        ) : computed.factors.length === 0 && (computed.unknownNutrients.length > 0) ? (
          <p className="mt-1 text-[10px] text-ink/55">
            No table match. Unknown: {computed.unknownNutrients.map((code) => NUTRIENTS[code].label).join(", ")}.
          </p>
        ) : computed.factors.length === 0 ? (
          <p className="mt-1 text-[10px] text-muted">Nothing changes with this operation.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-[11px]">
            {computed.factors.map((f) => {
              const beforeVal = computed.before.totals[f.nutrient];
              const afterVal = beforeVal != null ? beforeVal * f.factor : null;
              const delta = beforeVal != null && afterVal != null ? afterVal - beforeVal : null;
              const pct = beforeVal != null && beforeVal > 0 && afterVal != null ? ((afterVal - beforeVal) / beforeVal) * 100 : null;
              const meta = NUTRIENTS[f.nutrient];
              const lossy = delta != null && delta < 0;
              const gained = delta != null && delta > 0;
              return (
                <li key={f.nutrient} className="flex items-baseline justify-between gap-2 rounded-md border border-line/40 bg-canvas/50 px-2 py-1">
                  <span className="text-ink/70">{meta.label}</span>
                  <span className="tabular flex items-baseline gap-2">
                    {beforeVal != null && afterVal != null ? (
                      <>
                        <span className="text-ink/45">{fmt(beforeVal, meta.precision)} {meta.unit}</span>
                        <span className="text-ink/25">→</span>
                        <span className={lossy ? "font-semibold text-warn-ink" : gained ? "font-semibold text-accent" : "text-ink/70"}>
                          {fmt(afterVal, meta.precision)} {meta.unit}
                        </span>
                        {pct != null && (
                          <span className={`rounded px-1 text-[9px] font-semibold ${lossy ? "bg-warn-soft text-warn-ink" : gained ? "bg-accent/10 text-accent" : "text-ink/35"}`}>
                            {pct >= 0 ? "+" : ""}{Math.round(pct)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-ink/35">? → ?</span>
                    )}
                    {f.source === "estimated" && <span className="rounded bg-warn-soft px-1 text-[9px] text-warn-ink">est</span>}
                    {f.source === "table" && <span className="rounded bg-accent/10 px-1 text-[9px] text-accent">tbl</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---------------- Ask AI ---------------- */}
      {aiAvailable && (
        <div className="mt-4 rounded-md border border-line/60 bg-bg p-2">
          <p className="mb-1.5 text-[10px] text-ink/45">
            Uses the step note above as context, if you wrote one.
          </p>
          <button
            type="button"
            onClick={onAskAi}
            disabled={estimating}
            className="mt-1.5 w-full rounded-md border border-line px-2 py-1.5 text-[11px] font-medium disabled:opacity-50"
          >
            {estimating ? "Asking…" : "Ask AI what changes"}
          </button>
        </div>
      )}

      {/* ---------------- All-18 modal ---------------- */}
      {detailOpen && computed && (
        <NutrientDetailModal
          before={computed.before}
          after={computed.after[0] ?? computed.before}
          onClose={() => setDetailOpen(false)}
        />
      )}

      <button type="button" onClick={() => onRemove(node.id)} className="mt-4 text-xs text-danger-ink underline">
        Remove step
      </button>
    </div>
  );
}

function NutrientDetailModal({
  before,
  after,
  onClose,
}: {
  before: Rollup;
  after: Rollup;
  onClose: () => void;
}) {
  const panelRef = useDialogFocus(true, onClose);

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="All 18 nutrients, before and after"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-card outline-none"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">All 18 nutrients</h3>
            <p className="text-[10px] text-muted">Before → after for this step</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink/40 hover:bg-ink/5">
            ✕
          </button>
        </div>
        <ul className="mt-2 divide-y divide-line/60">
          {NUTRIENT_CODES.map((code) => {
            const meta = NUTRIENTS[code];
            const b = before.totals[code];
            const a = after.totals[code];
            const changed =
              b != null && a != null && Math.abs(a - b) > Math.max(1e-9, Math.abs(b) * 1e-4);
            return (
              <li key={code} className="flex items-baseline justify-between gap-2 py-1.5 text-[11px]">
                <span className="text-ink/60">{meta.label}</span>
                <span className="tabular flex items-baseline gap-2">
                  {b != null && a != null ? (
                    <>
                      <span className="text-ink/40">{fmt(b, meta.precision)}</span>
                      <span className="text-ink/20">→</span>
                      <span className={changed ? "font-semibold text-accent" : "text-ink/60"}>{fmt(a, meta.precision)}</span>
                      <span className="text-[8px] text-ink/25">{meta.unit}</span>
                    </>
                  ) : (
                    <span className="text-ink/30">unknown</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}


function ConnectionInspector({
  edgeId,
  nodes,
  edges,
  onDisconnect,
}: {
  edgeId: string;
  nodes: Node[];
  edges: Edge[];
  onDisconnect: () => void;
}) {
  const edge = edges.find((e) => e.id === edgeId);
  const fromNode = edge ? nodes.find((n) => n.id === edge.source) : undefined;
  const toNode = edge ? nodes.find((n) => n.id === edge.target) : undefined;
  const nameOf = (n: Node | undefined) =>
    n ? String((n.data as { name?: string; label?: string }).name ?? (n.data as { label?: string }).label ?? "block") : "?";
  return (
    <div>
      <h2 className="font-display text-sm font-semibold tracking-tight text-ink">Connection</h2>
      <p className="mt-2 text-sm leading-snug text-ink/80">
        <span className="font-medium">{nameOf(fromNode)}</span>
        <span className="mx-1.5 text-muted">→</span>
        <span className="font-medium">{nameOf(toNode)}</span>
      </p>
      <p className="mt-2 text-[11px] text-muted">
        This wire feeds the output of one block into the next. Delete removes the connection, not the blocks.
      </p>
      <button
        type="button"
        onClick={onDisconnect}
        className="mt-3 w-full rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs font-medium text-danger-ink hover:bg-danger/10"
      >
        Disconnect
      </button>
      <p className="mt-2 text-[11px] text-muted">Or press Delete / Backspace with the wire selected.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function buildGraph(nodes: Node[], edges: Edge[]): Graph {
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
        data: {
          label: food?.name ?? node.foodId,
          grams: node.grams,
          amount: node.amount ?? node.grams,
          unit: node.unit ?? "g",
          foodId: node.foodId,
          unknownCount,
          note: node.note ?? null,
        },
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
        note: d.note ?? null,
      },
    } as Node;
  });
}

function buildInitialEdges(graph: Graph | null | undefined): Edge[] {
  if (!graph) return [];
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    animated: true,
    style: { stroke: "var(--accent)", strokeWidth: 2.25 },
    markerEnd: { type: "arrowclosed", color: "var(--accent)" },
  }));
}
