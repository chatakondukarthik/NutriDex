# NutriPlan — Session context 2026-11-15

**Purpose:** capture everything done across the recent session so a compacted
or new context does not lose track of state. Update this file at the end of
each major work block; never let it drift from the repository.

**Author rule:** if a change is made in code, this file is updated in the same
commit. If a promise is made to the user, it is recorded here next to the
commit that delivered it.

---

## Where the app stands (as of 2026-11-15, evening)

**Stack:** Next.js 16.4.6 (App Router) · React 19.3.1 · node:sqlite · Tailwind 4 · Vitest 5.1.0 · React Flow (`@xyflow/react`) · `@dagrejs/dagre`. Local DB at `data/nutriplan.sqlite`.

**Health snapshot:**

- `npm run typecheck` → clean
- `npm test` → **248 tests passing (21 files)**
- `npm run build` → clean
- Prod server `npx next start -p 3100` serves **all 12 routes 200**
- Dev server is **flaky** this environment — see Environment section below
- Committed through `11144ae`

**Uncommitted**: none — working tree clean apart from `.agents/`, `.codex/`,
`.cursor/`, `.gemini/`, `.github/`, `.gitlfs`, `skills-lock.json`, `data/`
(deliberately untracked agent/tooling artifacts).

---

## Commits shipped this session (newest first)

| Commit | Work |
|---|---|
| `11144ae` | **Create with AI** recipe generation (`/recipes/new`) — prompt → LLM → proposed DAG (steps + operations + grams); unknown ingredients auto-created as provisional foods; nothing saved until the user confirms a preview. Server action `previewRecipeFromPromptAction` (read-only) and `createRecipeFromPlanAction` (materialize). New `recipe-generator.tsx`, `src/lib/ai-generate-recipe.ts`. |
| `d6f6432` | **Flow editor rework** — palette gains category filter + “My foods only” toggle; process inspector rewritten: Inputs/Outputs with named outputs/tags/weighed grams; per-nutrient before→after values with real units, % delta and highlight; **All 18** nutrients modal; Ask AI with “extra context for the AI” textarea (cook's note). **Plan**: 3-pane bottom layout (Item detail wide / Day nutrition with protein bar / Week totals); **single merged Items table** with customizable nutrient columns, `All 18` popup, copy-to-palette + remove actions inline. |
| `8cef42e` | **Foods**: Import CSV + New food grouped in header; **Copy/Export** button (Copy JSON / Copy CSV / Download CSV) filtered-list aware. **New food editor rebuilt**: single-column layout, method cards (Type it in / AI fill / Barcode / USDA search), inline panels, `localStorage` autosave + restore banner + `beforeunload` guard. **AI-off hides everywhere**: Ask-AI hidden, AI tile disabled with Settings link. **Diary “Planned for this day”**: reads plan entries for the selected day with per-item kcal and total. **Plan mutations revalidate `/`** so Diary is live. |
| `eb3d316` | **Canvas UX**: zoom/−/+ and handles re-skinned with app tokens; **custom MiniMap** (`flow-minimap.tsx`) that mirrors the canvas cards (same colours, labels) with viewport rect and click-to-pan; nutrient visibility in inspector; **no auto-connect** (flash hint); **connection panel**: click any wire → Disconnect button; **USDA search in palette** with one-click import; `role="button"` + aria-labels on handles; **tap-to-connect** via RF native `connectOnClick`. **Removed parent `/recipes/loading.tsx`** — it caused every `/recipes*` route to show stale skeletons and never finish hydration. |
| `91cabf7` | **Keyboard editing**: Del removes, Ctrl+Z/Y undo/redo, Ctrl+A select-all, Ctrl+C/V copy/paste blocks (Ctrl/Cmd), Esc deselect. **Step nutrition**: recipe detail shows “What each step did to the nutrients” (before→after with `tbl`/`est`/`edited` badges). |
| `2fbd7bd` | **Flow recipes**: React Flow canvas replaces 5-step builder on `/recipes/new` and `/recipes/[id]/edit`; dagre auto-layout; Ask AI per step; **Convert legacy recipes** button on `/recipes`. LLM estimation per step with cache. |
| `ce6f2ce` | v2 graph save path (snapshot carries graph + layout + per-node before/after). |
| `be82f31` | Graph engine `computeGraph()` — Kahn topo sort, cycles rejected with path; retention factors (override/table/estimated) applied; multi-output splits; `retention_factors` table seeded from USDA-r6 (unverified fixtures). |
| `6583c92` | Delete for recipes (archived if referenced by plans) and foods (refused if referenced). |
| `3330923` | Earlier flow-chart work: `process_graph` on saved recipes, `ProcessGraphView` on detail page. |

Earlier foundation commits are in `PLAN.md`.

---

## Environment, known failure modes, and what works

### Dev vs prod vs cache

- This environment’s **Turbopack dev server wedges** frequently: routes return
  suspense fallback forever with no error in console or logs. Nothing the app
  code does, source rebuilds do not always fix it — a full `rm -rf .next &&
  npm run build` + restart is the reliable cure.
- **Production** (`next build` && `next start`) works correctly for hydration of
  every route immediately after a build; wedged dev state does **not** cross
  into prod.
- **Parent `loading.tsx` boundaries** are the cause of the “Loading …” stale
  SR-only text that never clears on hydrated pages. Pattern to apply when
  adding a new route segment: colocate `loading.tsx` *only* for leaf segments
  where the skeleton is truly wanted, and prefer to return the page directly
  rather than wrapping children in a skeleton boundary.
- The `/recipes/[id]` segment had a stuck loading.tsx that wedged all routes
  beneath it. **Removing it fixed every stuck route** in dev and prod.

### Hydration

- Fresh production build → hydration works immediately.
- If rebuild is required after every edit cycle, verify with the **fresh**
  build before investigating code-level issues.
- SSR output sometimes contains the fallback+content simultaneously; the DOM
  settles once hydration completes. Judge wiring by **interactive queries in
  the browser**, never by curled HTML alone.
- Some screens worked consistently (`/foods`, `/profile`, `/plan`, `/recipes`,
  `/recipes/[id]`, `/recipes/new`).

### AI provider quirks

- LLM schema for Gemini must not include `additionalProperties:false` — stripped
  in `adapters.ts` for Gemini only.
- Output truncation: 1024 → 4096 `maxTokens`; `parseProposal`/`parseEstimate`
  strip code fences and repair truncated JSON.
- `estimateNodeDeltas` caches results in `estimate_cache`; `complete()` has
  retry/fallback to a user-configured provider.
- `pro model` selection is fetched live from provider (`listModelsAction`).
- Embedding/nutrient authority order: **measured > table (USDA-r6) > LLM
  estimate > unknown**. Never let LLM override better evidence.

---

## Route map & what each does

| Route | Notes |
|---|---|
| `/` | Diary: manual food entry, search/filter, "Planned for this day" strip |
| `/plan` | Week plan board; day tabs + whole-week view; copy to next week/day; item table with columns; Day/Week nutrition panes |
| `/recipes` | Listing, "Convert legacy recipes" button, create flow |
| `/recipes/new` | React Flow canvas, palette (search, category, My foods), Ask AI per step, **Create with AI** button |
| `/recipes/[id]` | Detail: per serving, per 100 g, blocks, versions, step-by-step nutrient table |
| `/recipes/[id]/edit` | Flow editor on existing recipe |
| `/foods` | Browse/search/filter (category, My foods), Export JSON/CSV, New food |
| `/foods/new` | Method cards (Type it in / AI fill / Barcode / USDA), localStorage draft, dirty-guard |
| `/foods/[id]` | Food detail: 18 nutrients, portions |
| `/foods/[id]/edit` | Same editor, edit mode |
| `/foods/import` | CSV import with mapping |
| `/profile` | Targets, energy model, rails, live preview |
| `/settings` | Theme + **AI access** (provider, key, model, fallback, image override, call cap/test/remove) |
| `/glossary` | Nutrient glossary |
| `/about` | Methodology + rails + disclaimer |

---

## Decisions & open questions recorded this session

- **Recipe as DAG** (D-040 → D-046, registered in RECIPE_FLOWCHART removed; `spec/FLOW_RECIPES.md` is the canonical spec; earlier R1–R6 partial implementation was intentionally superseded).
- **Multi-output process blocks** split nutrients per nutrient (hung curd → curd + whey; dal → dal + dal water).
- **Terminal output tag**: `consumed` or `discarded`; discarding removes that output’s nutrients from the recipe total.
- **AI-off must be respected**: every AI surface renders its UI but is non-clickable/disabled, never silently removed.
- **Retention factors**: USDA r6 (public domain), provisional seed values marked `(seed, unverified)` until reviewed.
- **Create with AI**: provisional all-unknown foods created for unrecognized ingredients; user confirms before any recipe is saved.

---

## Carried forward — explicit user requests (NOT YET DONE)

1. **Scroll limits on the plan board** (rows inside the 7-day grid overflow):
   add `max-h-… overflow-y-auto` per cell and on the day items table; convert
   the table from "table in" pattern to a plain `<table>`.
2. **Recipes page: search + filters** (type, kind, cuisine?) plus scrolls.
3. **AI UI when AI is off universally**: every AI-related control (Ask AI,
   Create with AI, AI fill panels, etc.) must render disabled + unclickable,
   not disappear. Reconcile every AI action that currently gates on
   `isAiEnabled()`.
4. **Diary section revamp**: cannot show hundreds of foods inline; needs
   pagination/search; **before/after comparison** such as per-nutrient bars
   for the change vs yesterday or plan baseline; a **save button** somewhere
   explicit (implied).
5. **Plan tab save**: mirror the same "dirty → save" confirm pattern as the
   food editor (autosave + dirty guard).
6. **"Edit with AI"**: the universal Create/Edit with AI button — extend the
   generator panel to also accept the *existing recipe as context* and
   produce an edited version, with the same confirm/preview flow. Must work
   identically whether AI is on or off (disabled when off).
7. **Test Create/Edit with AI**: larger variety of prompts — new untracked
   processes (e.g., `ferment`, `cool`), new ingredients (soya chunks, drumstick
   leaves, etc.), edit round-trips, multi-output splits (curd vs whey), USDA
   fallback creation, step-reordering, and confirmations shown before commit.

## Next experiments / hypotheses (from the same conversation thread)

- **Prompt with intent**: `"palak sprouts bhurji, with less oil"` — does the
  model honor composition *labels*? Do new untracked ingredients get created?
- **Unknown-nutrient survive-rate**: are provisional foods still useful?
- **Evaluate low-context failure modes**: `"make me a dal"` with nothing else.
- **Edit without prompt**: empty context should keep the original graph.
- **Meal photo**: still explicitly out of scope; no current work planned.

---

## Files the next context should read first (in order)

1. `docs/SESSION-CONTEXT-2026-11-15.md` (this file)
2. `docs/build/PLAN.md` — slice status S0..S10 (mark items when they ship)
3. `docs/spec/FLOW_RECIPES.md` — engine/fork spec
4. `docs/CANVAS_UX.md` — user-complaint tracker (mark each row when verified)
5. `src/components/flow-editor.tsx` — editor; largest file, mutations are
   deferred until next spotable work unit
6. `src/lib/nutrition/graph.ts` — engine; keep in sync with
   `docs/ref/NUTRITION.md` during any change
7. `vitest.config.ts` + `tests/` layout: `unit` (node, 16 files, 212 tests;
   `unit` project) / `component` (jsdom, axe-core)

## Quick commands

```bash
npm run typecheck
npm test
npm run build
npx next start -p 3100   # prod
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/<route>
```

## Skills available and when to use them

This repo ships a working app; UI work should apply the design skills rather
than freestyle. Use them, in this order, **before** a page or surface is
reshaped:

1. **`ui-ux-pro-max`** (installed at `.agents/skills/ui-ux-pro-max/` and
   `.codex/skills/ui-ux-pro-max/`) — searchable local SQLite-backed database:
   80 product palettes, 192 font pairings, 74 font files, 120 UX guidelines,
   stack-specific stack CSV (this project: Next.js 16 + Tailwind 4 + React).
   Use it to pick a coherent set of tokens and to check a specific surface
   against its `ux-guidelines.csv` before touching CSS. Command:
   `python3 .agents/skills/ui-ux-pro-max/scripts/search.py "<problem>" --domain ux|palette|typography|motion|chart`
   The reference lists live in `references/quick-reference.md` and
   `references/pro-rules.md` — load those when auditing, not each time.
2. **`frontend-design`** (`.agents/skills/frontend-design/`) — opinionated
   visual direction: palette, typography, layout, subject-grounded styling.
   Use it when a page needs to be *designed*, not decorated — e.g. the Diary
   or Plan nutrition pane, the recipe editor canvas, the New Food flow.
3. **`impeccable`** (v0.1.23, installed globally in `~/.opencode/`) — full
   design-system engine: can generate palettes, typography, shapes, motion
   recipes on demand. Use sparingly; only when the work *is* a UI redesign
   (Diary revamp, canvas restructure). Don't spin it up for small edits.
4. **`ui-ux-pro-max` scripts** are the cheapest of the three. Reach for them
   first for targeted lookups (palette for preview canvas, typography pair
   for the settings panel, motion timing for an animations pass).

### How to use them

- **Before building a new piece of UI**, find 2–3 authoritative patterns in
  `ux-guidelines.csv` (filterable by domain and stack) and treat them as
  acceptance criteria.
- **When the user's request is vague** ("revamp the Diary", "make the plan
  look nicer"), translate it into: *product role* (what job does this page do
  for the user — plan meals quickly? avoid mistakes? explore?) and *audience
  knowledge* (novice vs experienced cooks).
- **Any time a component gets more expensive** (adds a mode, a new pane, a new
  field), audit labels, contrast, focus order and hit targets against the
  same guidelines, not just vibes.
- **Decisions go into D-records** (`docs/decisions/DECISIONS.md`). If the work
  reverses an earlier call (e.g. "AI-off should hide" vs "display but
  non-clickable"), write the superseding record and link both ways.

### Where they apply in this app

- `/plan` — dense data grid, mobile overflow, empty/loading states,
  skeletons, drag-and-drop a11y
- `/` (Diary) — before/after comparison layout, search ergonomics, focus order
- `/recipes/[id]/edit` — canvas ergonomics, minimap theme tokens, drag
  threshold, tap-to-connect affordance
- `/foods/new` — long form, method choice UX, destructive-action confirm
- `/settings` — AI provider form, capability filters, destructive removes

## State after 2026-11-15 late session

### New since the morning compaction

- **Plan board**: day cells scroll at `max-h-[280px]`; 7-day grid reflows on small screens.
- **/recipes**: search by name + dish/component filter + 600 px scroll (`recipes-browser.tsx`).
- **Create / Edit with AI**: `RecipeGenerator` is one component for both paths, present on
  `/recipes/new` and `/recipes/[id]/edit`; renders the button disabled
  (labelled) when `aiStatus().enabled` is false instead of vanishing.
  Server actions plumb `recipeId` so the same flow writes a new version.
- **Diary recipes**: `entries` now stores a food XOR a recipe version (`recipe_version_id`
  REFERENCES recipe_versions), with a boot-time rebuild; `dayRollup` scales recipes from the
  pinned snapshot; Diary has a Foods/Recipes tab pill; logged list merges both with correct
  units; lists are scrollable; `addRecipeEntryAction` + `countRecipeReferences` include
  diary references so recipes used there archive instead of deleting.
- **Save indicators**: Plan footer shows "All changes saved"/"saving…"; Diary header shows
  "✓ Saved".
- **Planned vs Logged** strip on Diary with planned kcal vs today's logged kcal.
- **.gitignore covers `data/`** — it held `nutriplan.sqlite*` and `secrets.json` uncommitted.
- **Tests**: 264 passing across 22 files; added diary recipes component suite and
  entries-table data-integrity cases.

### Browser wedge (unresolved, environmental)

Both `next start` (clean build) and `next dev` on fresh tabs render SSR HTML but React
**never hydrates** — content streams in inside `<div hidden>`, `"Loading diary"` fallback
stays visible on every route, zero console output, zero failed requests. SSR HTML is
correct (tab pill, markup present) and `npm test` + `tsc` are the reliable verification
loops until the environment is restarted. If hydration works for you locally,
verify `/` → Recipes tab → pick "Paneer bhurji" → Servings 1.5 → Add.

## Incident 2026-11-15 late: `.next` deleted under a running dev server

`rm -rf .next` was run during a verification cycle while the user's `next dev`
on port 3000 was live. Next detected the missing `.next/dev` and refused to
continue ("The directory at .../.next/dev was deleted ... Restarting the
server to recover...") — both servers died. Recovery: `rm -rf .next` once
nothing was running, then `npm run dev` on 3000; SSR verified with 200s.

Rule from this incident: **never `rm -rf .next` while any Next server might
be running, and never `pkill -f "next"` indiscriminately — that sweeps up the
user's own dev server.** Only stop servers this session started, and confirm
ports are free before cleaning. Ask first when in doubt.

## Feature batch 2026-11-15 (evening)

Committed `21e0dd1`:

1. **Recipes search by ingredient** — `src/lib/recipe-filter.ts` (pure, tested):
   text query matches name or any ingredient name/alias (haystack built per
   recipe in `/recipes` page from `listRecipeIngredientIds()` — current
   version, GROUP_CONCAT). `recipes-browser.tsx` gains an ingredient dropdown
   with usage counts, chips on each card (click = filter), and the text box
   now searches ingredients too.
2. **Canvas select mode** — top-left toggle (Hand / box-select icon) in
   `flow-editor.tsx`; `panOnDrag` vs `selectionOnDrag` +
   `SelectionMode.Partial`. **Copy** (Ctrl+C / Copy) now writes a portable
   JSON fragment (`src/lib/recipe-fragment.ts`, app `nutriplan-flow`,
   version 2, whitelisted node data). **Paste JSON…** opens
   `paste-fragment-dialog.tsx` with a strict validator (used by both the
   dialog and Ctrl+V); v1 envelopes still accepted.
3. **Leave guard** — `src/components/leave-guard.tsx`: `useLeaveGuard`
   intercepts in-app link clicks (capture phase), Back button (pushState
   sentinel + popstate) and `beforeunload`; `LeaveGuardDialog` offers
   Save & leave / Discard changes / Stay (Escape = stay, safe default).
   Wired into the flow editor (recipes new/edit) with a JSON baseline
   (name/version/instructions/servings + buildGraph output + rounded
   positions). NOTE: flow-editor `save()` now returns `{ ok, recipeId }`;
   the toolbar Save button must not call it bare (navigation happens there).
4. **Scroll** — `/foods` grid is capped at 70vh with internal scroll; all
   other long lists (recipes grid, diary foods/recipes tabs, plan palette,
   logged, planned) already scroll.

Tests: 302 passing across 27 files (new: fragment parser, recipe filter,
recipes-browser, leave-guard, paste-fragment-dialog). jsdom is still the
reliable verification path while the browser wedge persists.

## Rules of engagement recapped

- Never make claims about what hydrated without querying the browser DOM.
- If routes intermittently fail, do a fresh `rm -rf .next && npm run build` and
  verify against a fresh prod on 3100 before filing a code-level diagnosis.
- Always confirm what the user actually asked for before expanding scope; if
  in doubt, grep for matching strings or ask.
- When a "beforeunload"-style protection is requested, apply the food-editor
  pattern elsewhere (recipe editor, plan board) consistently.

*Last updated: 2026-11-15 21:58*
