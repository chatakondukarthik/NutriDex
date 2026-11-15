# NutriPlan — Recipe canvas UX: audit and plan

**Status:** Active plan (2026-11-15)
**Owner:** flow-recipes surface (`src/components/flow-editor.tsx`,
`src/components/flow-nodes.tsx`, `src/components/flow-minimap.tsx`)
**Relates to:** D-040…D-046, FLOW_RECIPES.md, S10 in `build/PLAN.md`

Rule for this document: every item is a *complaint observed by the user on a
live build* or a *consequence a simulation exposes*. Items are removed from the
list only by being shipped and verified, not by being argued away.

---

## Complaint log (verbatim intent, 2026-11-15)

| # | Complaint | Root cause |
|---|---|---|
| C1 | Zoom +/- and the bottom-right preview look like a different product | React Flow `Controls`/`MiniMap` ship default styling, different palette |
| C2 | Preview (MiniMap) is not "almost the same copy"; label-less coloured rectangles, different colours | MiniMap renders generic boxes via `nodeColor` without names |
| C3 | "10 unknown" on a food card is meaningless when you cannot see *which* 10 | Counts shown; names hidden |
| C4 | Clicking "Add process block" auto-connects *all* ingredients | Convenience win turned surprising for real cooking order |
| C5 | Clicking a connection shows no delete affordance | No `onEdgeClick` handler; Delete key only discoverable if you know |
| C6 | Cannot search a new food (e.g. "moong dal", "sprouts") from the canvas | Palette only searches the existing seed + captured library |
| C7 | Editing a real recipe mid-build (change amounts, remove things, add ingredients) needs to be frictionless | Full simulation needed to find what breaks |

## Plan

### 1. Theme the canvas chrome (C1)
- Replace default React Flow `Controls` styling with theme tokens: surface bg,
  line borders, ink icons, accent on hover, radius. Done via a small
  `globals.css` block re-skinning `.react-flow__controls-*` and `.react-flow__minimap`.
- Canvas background: keep `var(--canvas)` dots at very low opacity.

### 2. Custom MiniMap that mirrors the canvas copy (C2)
- New component `flow-minimap.tsx`: SVG viewBox of the world; every node drawn
  as a rounded rect using **the same colours as the canvas node cards**
  (surface fill, line border), with the node's **label in the muted ink
  colour**. Selected node gets an accent border. Discarded outputs get a
  dashed border. Viewport rectangle drawn in accent.
- Click anywhere to move the viewport centre there (`setCenter`).
- No green/purple rectangles. No palette unrelated to the app.
- Honour `data-motion="reduced"` (no pan animation) and the theme accent.

### 3. Nutrients you can inspect (C3)
- Food card: the unknown count stays, but the inspector (click the node) shows
  **all 18 nutrients** with values or `unknown`, plus which are estimated.
- Step (process) inspector: replace "n unknown" with the **named list** of
  unknown nutrients; show the same full 18-nutrient table per output.
- After asking AI, rows the model filled are accented and revertible
  per-nutrient (D-016 pattern reused).

### 4. No auto-connect (C4) — removed, deliberately
- New process nodes are never wired automatically. New node is selected; a
  hint flash says "drag from an ingredient's output dot to this step".
- Rationale: cooking order is the user's statement of intent; auto-connect
  asserts one. Adding an ingredient does not wire either.
- Simply **adding a step to a canvas with zero nodes never creates an edge**.

### 5. Connections are first-class (C5)
- `onEdgeClick` selects the edge (React Flow ring) and opens a **Connection**
  inspector: `from → to` names, mass, Disconnect button, Delete-key hint.
- Deleting the edge works from keyboard `Delete`, inspector button, and
  `Backspace`.
- Right-click on an edge offers Disconnect as well (context menu avoided for
  now — inspector + keyboard is enough).

### 6. Search the food database from the palette (C6)
- Palette gains a **"Search USDA / library…"** action (existing list search
  unchanged). Enter text → `searchUsdaAction` → results with nutrient counts →
  click **Add as ingredient** → the food is created as a `branded`/USDA
  captured food (source `usda`, code recorded) and added to the canvas.
- Captured fallback: a zero-result query offers **"Create 'sprouts' as a new
  food"** which jumps to `/foods/new?prefill=sprouts`.
- The foods list is held in component state; newly imported foods appear
  instantly.

### 7. Simulation matrix (C7)
Simulate a real build, record what breaks:

1. New recipe "sprouts bhurji": onion → sauté, tomato → add, moong dal sprouts
   (imported via C6) → add, assemble, save.
2. Change amounts: onion grams 80 → 120; observe bars/values update.
3. Remove an ingredient and an entire step; observe edges and totals recover.
4. Add an ingredient **mid-process** (masala after step 1).
5. Ask AI what changes for a step; verify factors appear with `est`.
6. Save → `/recipes/[id]`: per-step before→after table correct, versions pinned.
7. Delete the whole recipe; ensure pins/plans unaffected.

### 8. Shortcuts reference (for docs and the hint bar)
- Del/Backspace: remove selected
- Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z: undo / redo
- Ctrl/Cmd+C · Ctrl/Cmd+V: copy / paste blocks
- Ctrl/Cmd+A: select all · Esc: deselect
- Shift-drag: box select · Shift/Ctrl-click: multi-select
- Ctrl/Cmd+S: save (bound to Save recipe)

## Shipped status (verified on production build 2026-11-15)

| Item | Status |
|---|---|
| Theme tokens for Controls | done — re-skinned `.react-flow__controls-*` in globals.css |
| Custom MiniMap (canvas copy) | done — `flow-minimap.tsx`; node card copy, viewport rect, click-to-pan |
| Nutrient visibility in inspector | done — food: all 18 per 100 g, known/est/unknown; step: unknowns named |
| No auto-connect | done — flash hint instead |
| Connection inspector + Disconnect | done — edge click opens Connection panel; Delete key removes |
| USDA search in palette | done — search → import → node created; new foods visible immediately |
| Simulation matrix run | done — full build on prod: onion/tomato/paneer + USDA moong-dal sprouts wired into one step, AI estimate available, saved as "Sprouts bhurji"; `/recipes/[id]` shows per-step before→after with LOOKUP/est badges |
| Tap-to-connect | done — RF native `connectOnClick`; handles carry `role="button"` + aria-labels |
| Phantom SR text / stuck Suspense | done — removed parent `src/app/recipes/loading.tsx` (caused stale SR-only text and hard Suspense wedge on every `/recipes*` route) |

**Recipe edit wiring:** `/recipes/[id]/edit` correctly opens the stored graph
with layout and all five nodes — verified on development and production builds.

**Environment note:** the dev server (`next dev`) would wedge periodically on
this machine with every route stuck on its loading fallback; the production
build behaves correctly. The parent `/recipes/loading.tsx` was the concrete
root cause for the `/recipes*` half of the wedge. Delete that file rather than
fighting Turbopack.
