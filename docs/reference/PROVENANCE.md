# Provenance — how the app knows which number to trust

Every nutrient value comes from somewhere. This is the contract that
decides what the user sees, what may be overwritten, and when AI may add
values. Read this before changing anything about nutrients.

## The question being answered

AI can fill any nutrient. It cannot do so reliably — and for a food a
lab measured, filling the gaps with guesses erases the value of the
measurement itself. This document is the policy for that trade.

## The three classes

The app does not treat all foods equally. Every `captured_foods` row is
one of these:

| Class | Written by | Examples | Trust | AI fill |
|---|---|---|---|---|
| **A — measured/reference** | a lab or a compiled analytical table | USDA Foundation, SR Legacy, Survey (FNDDS); INDB tables | High — the value is a *measurement* (or a mean of many) | **Opt-in only.** Filling joins guesses to lab numbers; every fill is marked `AI est.` |
| **B — claimed** | the manufacturer | USDA Branded, Open Food Facts, barcode imports | Medium — the value is a *claim* on a package | **Opt-in.** Most useful case — gaps are usually "not printed", not "untrue". |
| **C — authored** | the user or the model, on purpose | Manual entry; values AI read off a photo; values AI invented for an unseen food | Variable — everyone is guessing | **Opt-in**, and the recipe pipeline fills automatically on save (see the carve-out below) |

Class is read from `captured_foods.source` / `source_code`:
`usda → A or B` (by `dataType`), `indb → A`, `llm → C`, user-created → C.

## Origin filters (shipped 2026-11-19)

Provenance is also filterable, not only visible:

- **Foods / Spice Rack** — `All · Built-in · USDA · INDB · Open Food Facts · Yours · AI-filled`.
  `Yours` = household captures with no AI evidence; `AI-filled` = any nutrient value
  stamped `method` beginning with `ai:` (or `source_kind = 'llm'`). AI evidence outranks
  the named source: a USDA-lookup food with AI-filled nutrients matches `AI-filled`.
  Both built-in (seed) foods and anything the household authored stay distinguishable
  at a glance.
- **Recipes** — `All · Authored · AI-designed · Preset · Promoted · Legacy`, keyed off
  the recipe version's `label`; a missing label is Authored.
- `recipe_versions.label` is the recipe's authoring signal. `promoted` marks a recipe
  created by promoting a food entry; `preset` an app preset adapted; `legacy` an
  imported pre-household recipe; `ai` an AI-designed one.
- 2026-11-19: SuperYou Chocolate Fermented Yeast Protein and MillD High Protein Flour
  were stamped `source_kind = 'llm'` (the household confirmed both were AI-filled).
  Backup taken before the stamp — `nutriplan-before-ai-kind-stamp.sqlite`.

## The invariants (all enforced today)

1. **Only unknown cells are filled.** `estimateNutrients` writes only
   `unknown` cells — never `known`, never an earlier `estimated` value.
   A user override is a *claim of truth* and is never touched.
2. **Every AI-written cell is labelled.** Stored as
   `status: "estimated"`, `method: "ai:<provider>:<model>"`, with a
   per-cell `note` (reason) and the model id. The detail page shows a
   banner ("N values are AI estimates…") and a chip per row; the diary
   and recipes keep them out of `known` coverage (`rollup` in
   `engine.ts` builds totals only from present values and marks
   `estimated` when coverage is partial).
3. **Fill is a deliberate action,** never a side effect of capturing,
   saving or importing — except the one carve-out below.
4. **Seed foods are never filled.** They are synthetic fixtures; the
   estimate action refuses them, deliberately.
5. **A food's measured identity stays.** A USDA food with AI fills is
   still `source: "usda"` with a USDA `source_code`. Provenance drives
   the UI; it does not launder estimates into measurements.

## What USDA absence means

USDA returns **nothing** for an unmeasured nutrient; the import writes
`amount: null, status: "unknown"`. When a branded label *prints* 0.00,
USDA returns 0 and the app stores a **known 0**. The import can therefore
never invent zero — the constraint lives in `captured-food.ts`
(`prepareNutrients`: absent code → `push({ nutrient: code, amount: null,
status: "unknown" })`) and in the engine's `rollup` (missing values are
never zero; totals carry a coverage ratio).

## The carve-out: bulk recipe creation

`createRecipeFromPlanAction` fills missing ingredient nutrition by
default on the "create recipe from AI plan" flow (`fillMissingNutrition:
true`). This is deliberate and *only* suitable there: the foods were
just authored by the model, and the save is the explicit moment the user
commits to them. It can be disabled per call
(`fillMissingNutrition: false`) and it obeys all invariants above.

## What the user should do, by situation

| Situation | Recommended |
|---|---|
| USDA import, huge gaps (Vitamin D, B12…) | Live with it. The gap is honest: nobody measured it. Fill only if you accept labelled guesses for your own tracking. |
| USDA Branded, most macros present, vitamins missing | **Fill is reasonable** — manufacturer never printed them. |
| Manual food you typed yourself, many unknowns | **Fill is the point** — you wrote whatever you had; the model can complete it. |
| USDA reference food, comparing against supermarket own-brand | Prefer not to fill — the estimates will mask the differences you're measuring. |

## What we will never do

- Silently zero-fill an absent nutrient.
- Overwrite a known or a user value.
- Apply estimates without the `AI est.` mark in the UI.
- Fill seed foods, or auto-fill on capture/import/save (except the
  carve-out above).
