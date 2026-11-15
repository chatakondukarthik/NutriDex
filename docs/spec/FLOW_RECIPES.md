# NutriPlan — Flow Recipes: recipes as a directed graph

**Status:** Proposed (design, not committed)
**Date:** 2026-11-15
**Relates to:** D-021 (blocks), D-022 (inert operations), D-023 (pinned reuse),
D-026 (yield/retention deferred), D-016 (per-nutrient diff), D-034/D-035 (AI),
D-039 (colour alone is not status)
**Research:** USDA Table of Nutrient Retention Factors (Release 6, public
domain), IFCT cooked-state records, recipe_grid / Galley / ESHA Genesis prior art
**Supersedes:** the linear block model of `docs/spec/PATCH_recipe_and_ai.md`
(its validation, pinning and provenance rules carry over unchanged)

---

## 1. The problem with the current model

A recipe today is a linear list of blocks. That is wrong twice:

1. **Cooking is a graph, not a list.** Block 1 (cashews + tomatoes + spices →
   cook → blend) and block 2 (paneer → fry) run in parallel, and block 3
   combines both. There is no order between them until block 3 exists.
2. **Cooking changes the food.** Boiling, straining, reducing, frying,
   cooling and fermenting all change either mass or per-nutrient retention —
   or both. The engine currently treats operations as inert (D-022) because we
   had no data. That made the model honest but useless for the actual question
   the user is asking: *"what does this block do to my vitamins?"*

The user's example is the test case:

> 50 g paneer, some cashews, 100 g tomatoes, spices.
> Block 1: cook cashews + tomatoes + spices, then blend into a tomato mixture.
> Block 2: fry paneer.
> Block 3: combine 1 and 2 → the curry.

Block 2 may change the paneer's profile (oil absorbed, moisture lost). Block 1
will change both mass and nutrients (water added, vitamins leach into the pan
liquid, blending itself changes nothing). Block 3 changes mass (you may lose
some gravy) but not nutrition, except for the leached-out tail.

And hung curd out of curd gives **two outputs**: thick curd + whey. The model
must support multi-output processes with per-output nutrient partitions.

---

## 2. Core model: a DAG of typed nodes

```
        (food)                (food)              (food)
          │                     │                   │
          ▼                     ▼                   ▼
      ┌────────┐           ┌────────┐          ┌────────┐
      │ COOK   │           │ FRY    │          │  raw   │
      │ tomato │           │ paneer │          │ spices │
      │ cashew │           │        │          │        │
      └───┬────┘           └───┬────┘          └───┬────┘
          ▼                     ▼                   │
      ┌────────┐                │                   │
      │ BLEND  │                │                   │
      └───┬────┘                │                   │
          ▼                     ▼                   ▼
        output A            output B           (joins block 3)
          │                     │
          └─────────┬───────────┘
                    ▼
               ┌────────┐
               │ COOK   │        (block 3: combine & simmer)
               │ COMBINE│
               └───┬────┘
                   ▼
              final dish
```

### 2.1 Node types

| Type | Inputs | Outputs | Nutrition effect |
|---|---|---|---|
| **food** | — | 1 | None. Loads a library food's profile. |
| **component** | — | 1+ | None beyond the pinned component's snapshot (D-023). |
| **process** | n | 1..m | Applies retention factors + mass yield + splits. |
| **output** (tag) | 1 per input | — | Tags terminal outputs as consumed or discarded. |

### 2.2 Process types

Each process has a named operation. The list is extensible; seed with:

`grate, dice, slice, chop, wash, soak, boil, steam, pressure-cook, sauté, fry, deep-fry, roast, bake, grill, blend, strain, boil-drain, reduce, assemble, mix, marinate, ferment, cool, rest, refrigerate, freeze`

A process does three things, in order:

1. **Retention** — per-nutrient factors (vitamins C/B/minerals leach; heat
   degrades). Table-driven where possible (USDA Retention Factors), measured
   otherwise, LLM-estimated as a fallback (see §4).
2. **Yield** — mass in → mass out. Measured output mass wins. Otherwise a
   factor from the table, an LLM estimate, or 1.0 (no change) with a
   disclosure. This is D-022 corrected: the operation itself is inert, but
   the *process node* carries the factor.
3. **Split** — multi-output nodes (strain, hung curd) partition each nutrient
   across outputs by a fraction vector (see §3.3).

### 2.3 Edges

Edges carry: `{ grams, foodId | component pin | nothing }`. A food source is an
edge from a `food` node. An edge's `grams` is converted once through
`toGrams` on the server, like today.

Edges can connect an output of any process to any input of any other process.
Cycles are rejected at save. Merging: a node with two inputs is an implicit
merge — no special node type needed.

Mid-process ingredients: just a new `food` node placed anywhere, edged into
the process that adds it. No special mode.

### 2.4 Terminal outputs and "consumed"

The graph can have several terminal outputs. Each is tagged `consumed` or
`discarded`. Nutrition for **the dish** counts only consumed outputs. Hung
curd: `thick curd → consumed`, `whey → discarded`. The dish's total drops the
whey's share; that is not a guess, it is mass-weighted by the split.

---

## 3. The engine: `computeGraph(graph)`

Pure, total, and the most-tested module in the app. No I/O, no dates.

```
computeGraph(graph: Graph, foodsById) -> {
  perNode: Map<nodeId, ProcessResult>
  final: Rollup                       // consumed outputs only
  yield: { inputGrams, consumedGrams, yieldBasis }
  provenance: per-nutrient { status, source, nodeId, factor }
}

ProcessResult = {
  before: Rollup                     // sum of inputs
  after:  Rollup[]                   // one per output
  deltas: per-nutrient { before, after, factor, source, status }
}
```

### 3.1 Topological evaluation

1. Detect cycles → reject with the cycle path as a message.
2. Evaluate nodes in topo order.
3. For each process node:
   a. Sum input profiles (the "before" for every nutrient).
   b. Apply retention: `after_n = before_n × factor_n` for nutrients with a
      factor; unchanged otherwise.
   c. Apply yield: `after_total × (outputMass / inputMass)` does **not**
      change per-nutrient grams; the mass is recorded for per-100 g only
      (D-022 correct: absolute nutrients don't change because water boiled
      off). Split outputs are mass-partitioned.
   d. Apply split partitions (see §3.3) to divide each output's profile.
4. Final = combine of consumed outputs.

### 3.2 Retention factor model

```sql
retention_factors
  id            TEXT PRIMARY KEY
  operation     TEXT NOT NULL          -- "boil"
  qualifier     TEXT                   -- "drained" | "undrained" | "with water retained"
  nutrient      TEXT NOT NULL          -- NutrientCode
  factor        REAL NOT NULL          -- 0..2
  source        TEXT NOT NULL          -- "usda-r6" | "ifct-2017" | "measured" | "estimated"
  notes         TEXT
```

Priority when a node runs:

1. **Measured** — the user weighed the output or the drain; overrides everything.
2. **usda-r6 / ifct-2017** table row for (operation, qualifier, nutrient).
3. **estimated** — LLM (see §4), applied only to nutrients without a table row,
   tagged `estimated`, shown as a diff the user can accept/revert, and stored
   in the version snapshot as such.
4. **No factor** → the nutrient is unchanged and the node shows
   "no change in tracked nutrients" or "no data" — never a fabricated number.

Fat uptake when frying is not a special case: oil is an input with fat
retention 1.0 to the food output, and any water loss only changes mass. USDA
fry factors for nutrients can be seeded as qualifiers if we want decimal
fat-uptake factors; the model does not require them.

### 3.3 Multi-output splits

Each output of a multi-output node gets, per nutrient, a **partition weight**
(0 = none of that nutrient goes there, 1 = all of it). Weights across outputs
must sum to 1 per nutrient (anything left is "lost", e.g. nutrients dissolved
in discarded whey are exactly the whey partition).

Worked example — hung curd, 100 g curd → 70 g hung curd + 30 g whey:

| Nutrient | Hung curd | Whey | Basis |
|---|---|---|---|
| FAT | 0.98 | 0.02 | fat does not leach |
| PROCNT | 0.80 | 0.20 | protein stays mostly with curd |
| CHOCDF (lactose) | 0.35 | 0.65 | sugar leaches |
| NA, K, CA | 0.55 | 0.45 | minerals partially leach |
| VITB12, FOL | 0.60 | 0.40 | water-soluble, moderate leach |
| ENERC_KCAL | derived | derived | from split macros |

Split weights are **estimates** by default (source `estimated`); the user can
override per-nutrient in the inspector, or measure directly. All are visible
with source badges. This is honest: curd partitioning has no authoritative
published table, so it is marked, not claimed.

Boil → strain: the cooking-water output takes the leaching share of dissolved
minerals and B-vitamins. Boil with water discarded + drained = the
"boil, drained" USDA qualifier is equivalent and is how most people cook.

### 3.4 Yield

- Measured output mass per output (optional) — overrides table.
- Otherwise 1.0 (no change) with a note, exactly the current D-026 behaviour,
  but now per *node* instead of per recipe.
- Mass changes affect per-100 g, never per-nutrient grams (unchanged rule).

### 3.5 Validation

- Cycle detection with the cycle path in the error.
- Every input edge must resolve to a food or pinned component.
- Terminal-output tagging required: every terminal output must be tagged
  `consumed` or `discarded` before save.
- Portions/quantities convert through `toGrams` with the existing ceilings and
  overflow checks.
- A process cannot produce a negative partition sum.

---

## 4. The LLM's job (and its limits)

The LLM is an **estimator of nutrient deltas**, never a nutrition authority.

### 4.1 `estimateNodeDeltas(node, inputFoods) -> NodeEstimate`

Input: operation + ingredient profile summary (masses, per-100 g values as
*distribution*, not raw food dumps — no nutrient database leaves the client,
D-035). Output:

```json
{
  "factors": [
    { "nutrient": "VITC", "factor": 0.6, "reason": "heat-labile; boiling destroys ~40%", "confidence": "medium" },
    { "nutrient": "NA", "factor": 0.8, "reason": "leaches into cooking water", "confidence": "low" }
  ],
  "notes": "blending is mechanically inert; no nutrient change in tracked model"
}
```

Rules:

- Factors apply **only** to nutrients with no table row and no measurement.
- Every LLM factor is `estimated`, shown with a one-line reason, revertible.
- Temperature 0; the response schema is versioned and tested against the fake
  adapter; cache by `(operation, ingredient fingerprint)` so identical nodes
  across recipes cost nothing.
- The model never sees raw food ids, only names + summary profiles.
- Cool → "cooked rice cooled for a day": the honest answer is **no change in
  any tracked nutrient** (the resistant-starch story is real but not in the
  18-nutrient model), and this is a *great* test case for the harness.

### 4.2 Free information for the user

Every node shows its deltas inline: `VITC −40% (USDA boil/drained)` or
`VITC −35% (LLM estimate · undo)`. No factor anywhere → the node shows
"no measured change". The rules the app applies are always visible.

---

## 5. The interface

Built on **React Flow** (`@xyflow/react`, MIT) — the standard React node-graph
library. License clean, canvas is genuinely interactive, keyboard navigation is
supported, and it handles zoom/pan/minimap out of the box.

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Recipes    Tomato–Cashew Paneer Curry        Save · Review   │
├──────────┬───────────────────────────────────────┬─────────────┤
│ PALETTE  │            CANVAS                     │ INSPECTOR   │
│          │                                       │             │
│ [search] │  ┌────────┐      ┌────────┐          │ Block 2     │
│          │  │Cashews │      │Paneer  │          │ Operation   │
│ Foods    │  └───┬────┘      └───┬────┘          │ [fry ▾]     │
│ Tomato   │      ▼               ▼                │             │
│ Cashew   │  ┌────────┐   ┌────────┐             │ Before→After│
│ Paneer   │  │ COOK   │   │ FRY    │             │ VITC  100→65│
│  (drag)  │  │ 🍅+🌰 │   │ pan    │             │  .. 7 more  │
│          │  └───┬────┘   └───┬────┘             │             │
│ Components│      ▼            ▼                 │ Measured out│
│ Tadka v2 │  ┌────────┐                        │ [ 380 g   ]  │
│ (drag)   │  │ BLEND  │                        │             │
│          │  └───┬────┘                        │ Split editor │
│ Operations│      ▼            ▼                │ curd .98 fat│
│ boil sauté│  ┌────────┐   ┌────────┐           │ whey  .02   │
│ fry grill │  │ COMBINE│───▶│  final │            │             │
│ blend …   │  └────────┘   └────────┘           │             │
│           │                                      │             │
│ [＋Food]  │  zoom ⌗  auto-layout ⇥ undo          │             │
└──────────┴───────────────────────────────────────┴─────────────┘
```

Design decisions, grounded in the `ui-ux-pro-max` rule set:

- **One primary action per screen.** Palette drops, canvas edits, inspector
  edits. Save/Review in the top bar only.
- **Node = card, not a rectangle**: 12 px radius, operation icon, editable
  label, status dot. 44 pt hit targets; ports have 20 px invisible hit areas.
- **Plain language everywhere.** "Cook and then blend" not "process". Every
  operation shows its plain description in the inspector ("Heat destroys some
  vitamins; minerals leach into water").
- **Status is never colour alone** (D-039): delta lines say `−40%` and the
  factor's source; estimated factors carry an `est` tag and a reason.
- **Empty canvas** teaches the model with a 3-node starter template
  (Cook → Blend → Serve) and a "start from a known dish" gallery.
- **Undo/redo** (Ctrl/Cmd-Z) — node graphs without undo are hostile.
- **Keyboard**: Tab through nodes, Enter to edit, Space to toggle output tag,
  Delete to remove node, arrow keys nudge. Palette is a listbox; canvas is a
  treegrid.
- **Auto-layout** (dagre) on demand; manual drag otherwise; positions persist
  in the snapshot.
- **Review screen**: the final graph rendered small, with per-block before/after
  rollup, then the totals panel we already have (Day/week judgement unchanged).
- **Mobile**: canvas is pan/zoom; a "Step list" view (single-column ordered
  list of the topo order) is the responsive fallback — same data, simpler
  editor, full capability.
- **No new palette or tokens.** Uses the theme system; status colour rules
  shared with D-039.

### 5.1 What happens to the current builder

The 5-step builder is **archived, not patched**: route renamed
`/recipes/build-v1`, read-only, banner "This recipe uses the previous format.
Convert to the flow editor." Conversion script: each old block → one process
node with zero factors and its `outputGrams` preserved; the linear order
becomes the graph's chain. Conversion preserves the pinned-version, archive and
provenance rules unchanged. Calculation version bumps to `"2"`; v1 snapshots
stay byte-identical and readable forever.

---

## 6. Data model (additive)

```sql
retention_factors  (as §3.2)

graph snapshots live inside recipe_versions.snapshot as:
{
  version: 2,
  nodes:  GraphNode[],
  edges:  GraphEdge[],
  outputs: { nodeId, label, tag: 'consumed' | 'discarded' }[],
  result: { perNode: {...}, final: Rollup, perServing: Rollup,
            per100g: Rollup | null, yieldBasis, provenance: [...] },
  layout: { nodeId: { x, y } }
}
```

No other table changes. Entries, plans and components reference
`recipe_versions.id` exactly as before; a v2 version is indistinguishable to
the plan board except for a `v2` computation badge.

---

## 7. Slices

| Slice | Appetite | Done when |
|---|---|---|
| **S10.1 Engine v2** | 1–2 weeks | Cycle-safe topo evaluation; retention/yield/split application; per-node provenance; retention_factors seeded from USDA-r6 (~150 rows) + 2 tests per operation |
| **S10.2 LLM estimation** | 1 week | `estimateNodeDeltas` with fake-adapter tests, cache table, diff UI reused from D-016, golden cases for boil/fry/cool/blend |
| **S10.3 Canvas UI** | 2 weeks | Palette + canvas + inspector + review; undo/redo; node/edge keyboard nav; a11y pass; mobile step-list fallback; legacy builder archived |
| **S10.4 Migration** | 1 week | v1→v2 conversion; legacy badge; archive flow; plan board untouched |
| **S10.5 Docs & tests** | 3–4 days | Flow spec ratified as decisions (D-040+), TESTING.md rows, eval cases, docs updated |

Dependencies: none outside existing code + `@xyflow/react` (MIT) + `dagre` for
auto-layout. No new server-side runtime.

---

## 8. Risks and open questions

| Risk / question | Mitigation |
|---|---|
| USDA factors don't cover frying-in-Indian-style dishes | Tag `estimated` + user override; never claim measured |
| Retention factors have qualifiers (drained vs undrained) | Qualifier column; inspector makes drain an explicit choice |
| LLM variance in estimates | Temp 0, cache, golden set, `estimated` badge, user revert |
| Canvas accessibility | Step-list mobile fallback; full keyboard nav; axe pass on nodes |
| Multi-output splits are estimated | Marked `estimated`; user override; measured mass always wins |
| Bundle size of React Flow | Lazy-load canvas route only |

Unsolved, deliberately: bioaccessibility (Q-007, unchanged), resistant starch
(not in the 18-nutrient model — the cool-rice case will show "no tracked
change", which is honest), substitution suggestions ("use less oil?") — a coach,
not this slice.

---

## 9. Decisions to ratify (proposed)

- **D-040** Recipes are directed acyclic graphs of source / process / output
  nodes; linear builders are archived.
- **D-041** Retention is table-first (USDA-r6), measured-second, LLM-estimated
  third; every factor carries source and is revertible.
- **D-042** Multi-output processes partition nutrients per nutrient across
  outputs; whey/leach water are first-class tracked outputs, tagged consumed or
  discarded.
- **D-043** LLM estimates apply only to nutrients without table or measured
  factors; they are `estimated`, cached, and never override better evidence.
- **D-044** Discarded outputs remove their mass and nutrients from the dish;
  terminal outputs must be tagged before save.
- **D-045** Calculation version "2"; v1 snapshots read-only forever; conversion
  is explicit, never automatic.
- **D-046** The canvas is optional power; the step-list view is a full editor,
  not a degraded fallback.

---

## 10. Acceptance criteria

- [ ] Block 1 (cook → blend) shows per-nutrient deltas before/after with source.
- [ ] Block 2 (fry paneer) shows the same; oil input retention visible.
- [ ] Block 3 merges both; final totals equal the sum of consumed outputs.
- [ ] Hung curd produces two outputs; consumed-tag selection changes the dish's nutrients correctly.
- [ ] Whey discarded → its nutrient share leaves the dish total.
- [ ] Boil + strain removes leaching nutrients from the dish.
- [ ] LLM estimate applied only where no table row exists; revertible; tagged.
- [ ] Cooling cooked rice reports "no tracked nutrient change".
- [ ] Cycle rejected at save with the path in the message.
- [ ] Mid-process ingredient added anywhere; graph still computes.
- [ ] Old recipes open in legacy view; conversion works; plans unchanged.
- [ ] Canvas fully keyboard-operable; step-list view usable on 320 px.
- [ ] React Flow is lazy-loaded; builder route exists behind `/recipes/new`.
