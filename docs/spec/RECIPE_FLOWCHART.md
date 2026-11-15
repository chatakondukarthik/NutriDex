# Plan: Recipe as a flowchart of process blocks

**Status:** Proposed (design, not committed)
**Builds on:** PATCH_recipe_and_ai.md D-013…D-026
**Date:** 2026-11-15
**Relates to:** D-013, D-014, D-015, D-016, D-021, D-022, D-023, D-024, D-026, D-033, D-034
**Supersedes in part:** D-022 (operations are no longer nutritionally inert)

---

## 1. Problem

Today a recipe is a **linear list of blocks**. Each block has inputs, an
operation and an optional output mass. The operation is nutritionally inert
unless a yield is measured (D-022). That model can answer "how much of each
nutrient is in the dish" but it cannot answer the questions a cook actually
asks:

- "I boiled the tomatoes — how much vitamin C did I lose?"
- "I cooled the rice overnight — what happened to the starch?"
- "I blended the cashew-tomato base — did anything change?"
- "I hung the curd — I got thick curd *and* whey. Where does each go?"

It also cannot express that a process has **multiple outputs**, or that a
raw ingredient is introduced **in the middle** of a flow, or that two
branches run **in parallel** and merge later. The user described exactly
this: a paneer curry where block 1 turns cashews + tomatoes + spices into a
tomato base, and block 2 fries paneer, and a third block combines them —
with a possible hung-curd split along the way.

The current block model is a flat list pretending to be a process. It needs
to become a **flowchart**.

## 2. Goals

1. A recipe is a **directed acyclic graph of process nodes**. Each node has
   inputs (foods or outputs of earlier nodes), an operation, and one or more
   outputs.
2. Every node shows **before and after** nutrient values, with the change
   expressed both as an absolute delta and as a percentage.
3. The change comes from **reference retention factors** where they exist
   (USDA/IFCT yield & retention data), and from an **LLM estimate** where
   they do not — always marked `estimated` with a per-nutrient diff (D-016).
4. A node may produce **multiple named outputs** (hung curd → thick curd +
   whey), and downstream nodes may consume any of them.
5. A raw ingredient can be introduced at any node, not only at the start.
6. The UI is a **visual flowchart** (nodes + edges) that a non-expert can
   read top to bottom, with a clear "before → after" readout per node.
7. The existing recipe page, plan placement, versioning and pinning keep
   working — a flowchart recipe still saves a `recipe_version` with a
   computed nutrition snapshot.

## 3. Non-goals (for now)

- No arbitrary graph layout editor with drag-to-connect. v1 uses a
  **structured flow** (sequential + parallel branches + merge) rendered as a
  vertical flowchart with auto-layout. Free-form canvas is later.
- No real-time nutrition simulation while typing. Recompute on save.
- No per-nutrient retention literature database in v1. Tier 1 ships with a
  small seed table of common operations; everything else is LLM-estimated.

## 4. Data model

### 4.1 RecipeProcessNode

```ts
interface ProcessNode {
  id: string;                 // stable within a version
  label: string;              // human name, e.g. "Tomato base"
  kind: "input" | "process" | "split" | "combine" | "output";
  // What feeds this node. A food, or an output of an earlier node.
  inputs: ProcessInput[];
  // The process applied. "none" = no change (blend, mix).
  operation: ProcessOperation;
  // Measured output mass, if the user weighed it. Otherwise estimated.
  outputMassG: number | null;
  yieldBasis: "measured" | "estimated" | "none";
  // Named outputs. Most nodes have one. A split node has several.
  outputs: ProcessOutput[];
  // Layout hint for the flowchart renderer.
  lane: number;               // 0 = main flow, 1+ = parallel branch
  // Which nodes this node depends on (derived from inputs, stored for speed).
  dependsOn: string[];
}

interface ProcessInput {
  source:
    | { type: "food"; foodId: string }
    | { type: "node"; nodeId: string; outputIndex: number };
  grams: number;
  amount: number;
  unit: string;
  portionLabel?: string | null;
  preparation?: string | null;
  note?: string | null;
}

interface ProcessOutput {
  name: string;               // "Tomato base", "Whey"
  grams: number | null;       // null = unknown (not measured, not estimated)
  // Nutrients are computed, not stored, except the snapshot.
}

type ProcessOperation =
  | "none"        // mix / blend, no nutrient change
  | "cook"        // generic heat
  | "boil"
  | "steam"
  | "fry"
  | "roast"
  | "bake"
  | "blend"
  | "cool"        // includes chilling / refrigeration
  | "freeze"
  | "marinate"
  | "ferment"
  | "reduce"      // evaporation / concentration
  | "strain"      // separation, e.g. hung curd
  | "dry";        // dehydration
```

### 4.2 ProcessEffect (the transformation)

```ts
interface ProcessEffect {
  operation: ProcessOperation;
  // Per-nutrient retention factor. 1.0 = unchanged. 0.7 = 30% loss.
  // Absent means "unknown" -> the LLM or the engine decides.
  retention: Partial<Record<NutrientCode, number>>;
  // Added nutrients (e.g. oil absorbed, salt added). Per 100 g of output.
  added: Partial<Record<NutrientCode, number>>;
  // Removed nutrients (e.g. whey drained). Per 100 g of output.
  removed: Partial<Record<NutrientCode, number>>;
  source: "reference" | "estimated";
  rationale: string;
  confidence: number;         // evidence quality, 0..1
}
```

### 4.3 Retention reference table

A small seed table keyed by `(operation, nutrientGroup)` or
`(operation, nutrient)`:

```
process_retention
  operation   TEXT
  nutrient    TEXT
  factor      REAL   -- 1.0 = unchanged
  source      TEXT   -- "usda-retention", "ifct", "seed"
  PRIMARY KEY (operation, nutrient)
```

Seed values for the common operations (boil, fry, steam, bake, cool, freeze)
for the most loss-prone nutrients (vitamin C, folate, B12, thiamine,
sodium, water-soluble vitamins). Everything else defaults to 1.0 (no change)
and is disclosed as "no retention data — assumed unchanged".

### 4.4 RecipeVersion snapshot (extended)

The existing snapshot stores `total`, `perServing`, `per100g`, `inputGrams`,
`outputGrams`, `blocks`, `blockResults`. Extend `blocks` to carry the
flowchart:

```ts
interface BlockSnapshot {
  nodeId: string;
  label: string;
  operation: ProcessOperation;
  inputGrams: number;
  outputGrams: number | null;
  before: NutrientProfile;   // sum of inputs, scaled
  after: NutrientProfile;    // after process effect + yield
  change: Partial<Record<NutrientCode, { delta: number; percent: number }>>;
  effectSource: "reference" | "estimated" | "none";
  effectRationale: string;
  outputs: { name: string; grams: number | null; after: NutrientProfile }[];
}
```

The recipe's `total` nutrition is the sum of the final output nodes (the
nodes with kind "output" or the last node in the main lane).

### 4.5 Storage

`recipe_versions.snapshot` is already a JSON blob, so no schema migration is
needed for the snapshot itself. The `components` / `component_inputs` tables
were designed for the linear block model and cannot express a graph. Two
options:

- **Option A (recommended):** Store the flowchart as JSON in a new column
  `recipe_versions.process_graph TEXT` (nullable; null = legacy linear
  blocks). Keep `components` for backward compat with old versions.
- **Option B:** Replace `components`/`component_inputs` with `process_nodes`/
  `process_edges`/`process_inputs`/`process_outputs` tables.

Option A is the minimal change and keeps old versions readable. Option B is
cleaner but is a migration. **Decision needed (D-040).**

## 5. Nutrient transformation logic

### 5.1 Computing a node's "before"

`before = combine(inputs)` where each input is either a food (scaled to
grams) or a previous node's output (scaled to grams). Same rollup logic as
today, reused.

### 5.2 Applying the process effect

```
function applyEffect(before, effect, outputMassG):
  after = clone(before)
  for each nutrient code:
    if retention[code] present: after[code] *= retention[code]
    if added[code] present: after[code] += added[code] * (outputMassG / 100)
    if removed[code] present: after[code] -= removed[code] * (outputMassG / 100)
    if outputMassG present and inputMass present:
      // yield adjustment: total stays the same, per-100g changes
      // (already handled by the output mass; totals do not change here)
  return after
```

Key point: a process changes **totals** (retention/loss) and **output mass**
(yield). These are independent. Boiling loses vitamin C (total drops) AND
loses water (mass drops, concentrating the rest). Both are computed.

### 5.3 LLM estimation (D-034 applied)

When no reference retention exists for `(operation, nutrient)`:

1. The engine marks that nutrient's change as `estimated`.
2. A server action calls the LLM with: the operation, the ingredient list,
   the before-profile, and the output mass. The LLM returns a
   `ProcessEffect` proposal.
3. The proposal is re-derived through `applyEffect` and shown as a
   per-nutrient diff (D-016) before save. The user can accept or revert.
4. The accepted effect is stored in the snapshot with `source = "estimated"`
   and the model/prompt version in provenance.

The LLM is never allowed to change a nutrient the record does not know
(D-034). It can only propose retention factors for known nutrients.

### 5.4 Cooling rice / resistant starch

This is the case the user raised and it is the hardest, because the change
is not a loss but a **conversion**: digestible starch → resistant starch.
Our 18-nutrient model does not track resistant starch separately; it tracks
`CHOCDF` (carbohydrate) and `FIBTG` (fibre). Cooling increases resistant
starch, which is counted as fibre in some methods and as carbohydrate in
others. We cannot represent this honestly without a new nutrient code.

**Decision needed (D-041):** either add `RS` (resistant starch) to the
18-nutrient model (now 19), or document that cooling's effect is reported
as a note, not a number. Recommendation: document as a note in v1 ("cooling
increases resistant starch; not tracked as a separate nutrient yet") and
revisit when the model expands.

## 6. UI / UX

### 6.1 Flowchart view (recipe detail + builder review)

Rendered as a **vertical flow** with branching. Each node is a card:

```
┌─────────────────────────────────────────────┐
│  Block 1 · Tomato base           [cook]     │
│  ── inputs ──                               │
│   Cashew 30 g · Tomato 100 g · Spices 5 g   │
│  ── before ──                               │
│   Energy 180 kcal · Protein 4 g · Fat 9 g    │
│   Vit C 14 mg · ...                          │
│  ── process: cook 10 min, blend ──          │
│  ── after ──                                │
│   Energy 172 kcal (-4 %) · Vit C 9 mg (-36%) │
│  ── output: Tomato base · 110 g ──          │
└─────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│  Block 2 · Fried paneer          [fry]      │
│  ...                                        │
└─────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│  Block 3 · Combine & simmer      [cook]     │
│  inputs: Tomato base (from 1) + Fried paneer (from 2) + water
│  ...                                        │
└─────────────────────────────────────────────┘
```

For a **split** (hung curd):

```
┌──────────────┐
│ Block 4 · Hang curd │
│ input: Curd 500 g   │
│ ── outputs ──        │
│  Thick curd 200 g    │──► Block 5
│  Whey 300 g          │──► (discarded / Block 6)
└──────────────┘
```

Branches are shown side by side with a merge arrow. A node can have multiple
incoming edges (combine) and multiple outgoing edges (split).

### 6.2 Numbering scheme

Use **B1, B2, B3…** with sub-letters for parallel branches: **B2a, B2b**.
A combine node shows its parents: "B3 (B1 + B2a)". This is short, sortable,
and reads well in a sentence. Avoids the "1.a vs a.1" ambiguity the user
raised — the letter always comes after the number, and only on branches.

### 6.3 Builder flow (revised five-section flow, D-014 updated)

1. **Ingredients & blocks** — instead of a flat list, the user adds nodes.
   Each node: pick inputs (foods or previous outputs), pick an operation,
   enter measured output mass (optional).
2. **Process effects** — for each node with an operation that has no
   reference retention, the LLM proposes a diff; the user accepts/reverts.
3. **Yield** — measured output mass per node (D-026).
4. **Instructions** — free text, now referencing block IDs ("B1: cook the
   tomato base…").
5. **Review** — the flowchart + totals + per-nutrient coverage.

### 6.4 Before/after readout

Each node card has a compact "before → after" line for the headline nutrients
(energy, protein, fat, carbs, fibre, and any nutrient that changed by more
than 5%). A "details" toggle expands to all 18. Changed nutrients are
highlighted; unchanged ones are grey.

### 6.5 Mobile

The flowchart collapses to a **vertical list** on small screens, with
indentation showing branches. The full canvas is desktop-only.

## 7. UI components needed

- `ProcessGraph` — renders nodes + edges (SVG or reactflow). Decision:
  use `@xyflow/react` (reactflow) for the canvas, with a fallback list view
  for mobile. New dependency.
- `ProcessNodeCard` — the before/after card.
- `ProcessEffectDiff` — per-nutrient diff (reuses D-016 diff component).
- `BlockId` — small badge showing "B1", "B2a".
- `BranchMerge` — visual connector for combine/split.

## 8. Migration from the current model

Old recipes store a linear `blocks[]` in the snapshot. A migration converts
each old block into a `process` node with `operation = "none"` (inert, as
before) and `inputs` = the old inputs, `outputMassG` = the old output mass.
The resulting graph is a straight line: B1 → B2 → … → Bn. No nutrient
change is invented. Old versions remain readable; new versions use the graph.

The `components`/`component_inputs` tables stay for old versions. New
versions store the graph in `recipe_versions.process_graph` (Option A).

## 9. Slices

| Slice | Appetite | Done when |
|---|---|---|
| **R1 — Graph data model + migration** | 1 week | ProcessNode schema, snapshot extension, old-block migration, unit tests |
| **R2 — Process effects + retention table** | 1 week | applyEffect, seed retention table, unit tests for boil/fry/cool |
| **R3 — LLM estimation for unknown effects** | 1 week | Server action, diff UI, provenance (D-016/D-034) |
| **R4 — Flowchart UI (desktop)** | 1.5 weeks | reactflow canvas, node cards, before/after, multi-output |
| **R5 — Flowchart UI (mobile) + builder** | 1 week | Vertical list, builder node editor, review step |
| **R6 — Multi-output splits (hung curd)** | 3–4 days | Split nodes, named outputs, downstream consumption |

R1 is the blocker for everything else.

## 10. Decisions needed (new records)

- **D-040** — Storage: JSON column vs new tables. Recommendation: JSON
  column (Option A) for v1, migrate to tables only if querying nodes becomes
  necessary.
- **D-041** — Resistant starch / cooling. Recommendation: document as a note
  in v1, do not add a nutrient code yet.
- **D-042** — LLM is allowed to propose retention factors only for nutrients
  the record already knows; it may not invent values (D-034 restated for
  process effects).
- **D-043** — reactflow as a dependency. Recommendation: yes; it is the
  standard and saves weeks of canvas work.

## 11. Open questions

1. **How much of the graph does the plan need?** The plan only consumes the
   final recipe nutrition snapshot, so the graph stays inside the recipe.
   Confirmed: no plan changes.
2. **Can a user reuse a node across recipes?** A "sub-recipe" is already a
   component (D-023). A node could reference a component as an input. Yes.
3. **How do we version a graph?** Same as today: editing saves a new version
   with a new snapshot. The graph is part of the snapshot.
4. **What is the minimum viable graph?** A straight line of process nodes
   with before/after on each. That alone answers the user's question. Ships
   in R1+R2+R4.

## 12. Risks

- **reactflow bundle size** (~150 KB gzipped). Acceptable for a recipe
  editor; lazy-load the canvas route.
- **LLM retention estimates are guesses.** Mitigated by D-016 (diff,
  revertible, marked estimated) and by disclosing "no reference data" when
  both tiers are empty.
- **Cooking loss data is sparse.** USDA retention tables cover ~40 foods ×
  ~10 operations. Most Indian dishes will be LLM-estimated. The honest
  answer is to show the estimate and its confidence, not to hide it.
- **Scope creep.** This redesign touches the builder, the recipe page, the
  snapshot, and the DB. Strictly slice-gated; R1 must ship and be tested
  before R2 starts.

## 13. What this does NOT change

- Food/nutrition layer, diary, plan, profile, theme, settings.
- The 18-nutrient model (except the D-041 note).
- Pinned versions, archive-not-delete, version labels.
- The plan's consumption of recipe nutrition (still reads the snapshot).
EOF
echo written