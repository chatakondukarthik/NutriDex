# Ingredient capture — specification

**Status:** Proposed (design, not committed)
**Date:** 2026-11-15
**Relates to:** D-011, D-012, D-015, D-016, D-020, D-023, D-025, D-026, D-028, D-033, D-034
**Research:** [`research/notes/2026-11-15-fud-ai-and-llm-providers.md`](../research/notes/2026-11-15-fud-ai-and-llm-providers.md)
**Builds on:** [`PATCH_recipe_and_ai.md`](PATCH_recipe_and_ai.md) parts A and B

---

## 1. Problem

The builder and the diary can only use the 20 seeded foods. A user who cooks
with anything else has no way in, and the MVP spec already requires four entry
methods (D-011). Today the food list is a TypeScript fixture, so there is
nowhere to put a new food even if the UI existed.

Two questions have to be answered before any screen is drawn:

1. **What is being captured?** A food, a recipe, a sub-ingredient, or a
   one-off meal?
2. **Who is it for?** This meal only, or the library?

The user's wording — "scan and add something as ingredients or add that as
recipe or sub ingredient" — is three destinations for one capture. Getting this
wrong produces three near-identical wizards and three places to fix a bug.

---

## 2. Vocabulary

One definition per term, because the rest of this document uses them precisely.

| Term | Meaning | Example |
|---|---|---|
| **Food** | A single ingredient with a nutrition profile. May be raw or cooked. | paneer, atta, mustard oil |
| **Captured item** | The output of one capture: a food, a quantity, and optionally a preparation. Not yet placed anywhere. | "200 g paneer, crumbled" |
| **Provisional food** | A food that exists only because the user made it. It has no source database behind it. | "My homemade sprouts" |
| **Library** | The set of foods the user can search later. | saved custom foods |
| **Recipe** | A named, reusable, multi-ingredient unit (D-013). | Paneer bhurji |
| **Component** | A recipe with `kind = 'component'`, reusable as a block input (D-023). | Basic tadka |
| **Sub-ingredient** | A component used *inside* another recipe. Same entity as a component; the word describes the role, not a different model. | Basic tadka inside Dal |
| **Destination** | Where a captured item goes. | diary, plan slot, recipe line, component, library |

**Rule:** there is no separate "sub-ingredient" model. A sub-ingredient is a
component, and a component is a recipe. This keeps D-013's one-model rule.

---

## 3. The one pipeline

Every entry method produces the same intermediate shape and passes through the
same stages. The methods are adapters at the front; the destinations are
adapters at the back.

```
entry method                 resolution pipeline                    destination
─────────────                ───────────────────                    ──────────
search      ─┐
barcode      │
label OCR    ├─→ CaptureInput ─→ propose ─→ resolve ─→ review ─→ confirm ─→ place
text / LLM   │                    (adapter)  (pure)     (UI)     (UI)      (adapter)
manual       │
photo        ─┘
```

### 3.1 `CaptureInput`

```ts
type CaptureInput =
  | { method: "search"; query: string }
  | { method: "barcode"; code: string; source: "openfoodfacts" }
  | { method: "label"; images: CapturedImage[]; note?: string }
  | { method: "photo"; images: CapturedImage[]; note?: string }
  | { method: "text"; text: string }
  | { method: "manual"; name: string; nutrients?: Partial<Record<NutrientCode, number>> };
```

`CapturedImage` carries bytes, a MIME type, a byte size and a local identifier.
Images are evidence, never the source of truth (D-020).

### 3.2 `propose` — the adapter

A thin per-method function that turns raw input into a **proposal**. It is the
only place a network call or a model call happens.

```ts
interface Proposal {
  candidates: Candidate[];
  /** Why the user must look at this before it is used. */
  needsReview: boolean;
  /** Set when the method could not produce anything usable. */
  failure?: { reason: string; recoverable: boolean };
}

interface Candidate {
  /** Existing food id, or a provisional food the adapter built. */
  food: Food;
  quantity: { amount: number; unit: Unit; portionLabel?: string };
  preparation?: string;
  /** Where this came from, in words. */
  rationale: string;
  /** 0..1, derived from evidence quality — never from model confidence. */
  confidence: number;
  /** The per-nutrient diff if a value was adjusted (D-016). */
  adjustments?: NutrientAdjustment[];
}
```

### 3.3 `resolve` — the pure core

```ts
function resolve(input: CaptureInput, context: CaptureContext): Proposal
```

`resolve` is pure and synchronous. It:

1. Calls the adapter for `input.method` (injected, so tests pass a fake).
2. Normalises every candidate to **per 100 g** using D-020's basis rules.
3. Converts the quantity to grams through `toGrams` — the same function every
   other path uses, so a capture cannot invent a conversion.
4. Drops candidates whose food id is unknown and whose provisional record is
   incomplete.
5. Sets `needsReview` when any value is `estimated`, any basis was assumed, any
   candidate is provisional, or confidence is below a threshold.
6. Returns. It never writes.

**This is the function to test hardest.** Every capture bug is either a bad
proposal or a bad resolve, and only resolve is pure.

### 3.4 `review` and `confirm` — the UI

The review screen is a shared component used by every method. It shows: the food
name (editable), the quantity with visible units, the resolved grams, the
per-nutrient table with coverage, and any adjustment as a diff. Confirming
produces a `CapturedItem`. Cancelling throws it away.

### 3.5 `place` — the destination adapter

```ts
type Destination =
  | { kind: "diary"; day: string }
  | { kind: "plan"; week: string; day: string; slot: Slot }
  | { kind: "recipe"; recipeId: string; blockKey: string }
  | { kind: "component"; name: string; blockKey: string }
  | { kind: "library" }
  | { kind: "both"; place: Destination; library: true };
```

Placing is a normal server action, validated exactly like `addFoodAction` and
`addPlanEntryAction` are today. The captured item is never stored as JSON; it is
stored in the same tables as a manually entered item.

---

## 4. Entry methods

Maturity is stated per method. Nothing here is built yet.

| Method | What it does | MVP | Depends on |
|---|---|---|---|
| **Manual** | Name, category, optional nutrients, portions. | Yes (S6.1) | Foods in the DB |
| **Search** | Already exists in the diary. | Shipped | — |
| **Barcode** | Open Food Facts lookup by EAN. | Yes (S6.2) | OFF API, foods in the DB |
| **Label photo** | OCR the nutrition panel, propose a food. | Yes (S6.3) | S7 BYO LLM, foods in the DB |
| **Text / LLM** | "200 g paneer, crumbled" → structured proposal. | Yes (S6.4) | S7 BYO LLM |
| **Meal photo** | Estimate a plate. | **No** | Accuracy is not defensible |
| **Voice** | STT then text. | **No** | A capture method, not a new pipeline |

### 4.1 Manual

The baseline and the fallback for every other method. The form is deliberately
small: name, category, one portion, and nutrients the user actually knows.

- Nutrient entry is **not** a primary path (SCOPE.md "Never"), so the manual
  form's nutrient section is optional and labelled as "if you know it". An empty
  nutrient set is valid; the food is simply `unknown` everywhere.
- A manual food is a **provisional food**: it exists in the user's library, has
  no source database, and its provenance says so.
- Duplicate handling: search first, and warn on a near-identical name rather
  than silently creating a second "Paneer" (spec §6.3, still open).

### 4.2 Barcode

```
camera → EAN → Open Food Facts → product record → proposal → review → confirm
```

Rules:

- OFF data is **not** trusted as truth. It becomes a provisional food whose
  nutrient rows carry `source = "openfoodfacts"` and `source_food_code`.
- The label's basis (`per_100g` / `per_serving` / `per_pack`) is captured per
  D-020, and converted to per 100 g before it is stored.
- A product with no barcode match is a normal empty state with a "create it
  manually" action — not an error.
- OFF coverage in India is unverified. See open questions.

### 4.3 Label photo

```
photo → OCR/vision → structured proposal → review (diff) → confirm
```

- The model returns **candidate values with their basis and their units**, or
  nothing. It never returns a final nutrient profile; `resolve` builds one.
- A prefilled value is never accepted without confirmation (D-020, patch C.4).
- The image is stored as evidence and linked to the food record.
- If the label says "per serving" and gives a serving weight, the conversion is
  exact and the basis is disclosed. If it gives per-serving values without a
  serving weight, the record is `estimated` and the user is told.

### 4.4 Text / LLM

```
"200 g paneer, crumbled, fried in 1 tsp oil" → proposal[] → review → confirm
```

- The model returns a **list** of candidates, not one answer. "Two eggs and a
  latte" must produce three lines.
- Quantities are parsed by the model as a proposal, then re-resolved through
  `toGrams`. An implausible gram weight is surfaced, not silently stored.
- Ambiguity ("a handful") becomes an explicit `unknown` quantity with a prompt
  for the real amount, never a guessed number (D-007).
- See [`BYO_LLM.md`](BYO_LLM.md) for provider, key and prompt design.

### 4.5 Meal photo — explicitly out

Estimating a plated meal's nutrition from a photo is the feature users ask for
and the one this product must not ship first. Portion size, occlusion, cooking
fat and plating are all unobservable, and a wrong number here is indistinguishable
from a right one. It is a **Later** item and needs its own evidence budget before
it is designed.

---

## 5. Destinations

The capture ends with one question: **where does this go?**

| Destination | Effect | MVP |
|---|---|---|
| **Diary / plan slot** | A normal entry, as if typed | Yes |
| **Recipe ingredient** | An input line in the open block | Yes |
| **Recipe** | Promote the captured item into a new named recipe | Yes (S6.5) |
| **Sub-ingredient** | Create a component and pin it into the open block | Yes (S6.5) |
| **Library** | Save the food for later, place nothing | Yes |
| **Both** | Place it and save the food | Yes |

### 5.1 "Add as recipe"

A single captured item becomes a one-block, one-input recipe. This is D-013's
"save as recipe" promotion. It is not a special form.

### 5.2 "Add as sub-ingredient"

Creates a `kind = 'component'` recipe with one version and inserts a **pinned
reference** to that version into the current block. Because the component is
itself a recipe version, D-023's pinning, archive-not-delete and
update-available rules apply unchanged. No new schema is needed beyond the
`component_inputs.recipe_version_id` column already designed in DATA-MODEL §2.2.

### 5.3 Library vs use-once

D-012: using a food and saving it are separate. The default is **use once**.
"Save to library" is a checkbox or a second button, never a precondition.

---

## 6. Data model changes

Additive, following the existing migration rules.

```
captured_foods                          -- provisional + imported foods
  id            TEXT PRIMARY KEY
  name          TEXT NOT NULL
  aliases       TEXT NOT NULL DEFAULT '[]'   -- JSON
  category      TEXT
  kind          TEXT NOT NULL DEFAULT 'provisional'  -- provisional | branded | composite
  state         TEXT NOT NULL DEFAULT 'raw'
  density_g_ml  REAL
  basis         TEXT                          -- per_100g | per_serving | per_pack (D-020)
  serving_size_g REAL
  servings_per_pack REAL
  source        TEXT                          -- "manual" | "openfoodfacts" | "label" | "llm"
  source_code   TEXT                          -- OFF barcode, etc.
  image_path    TEXT                          -- evidence, not truth
  confidence    REAL
  created_by    TEXT NOT NULL DEFAULT 'local'
  created_at    TEXT NOT NULL
  archived_at   TEXT

captured_food_nutrients
  food_id      TEXT NOT NULL
  nutrient     TEXT NOT NULL
  amount       REAL
  status       TEXT NOT NULL          -- known | estimated | unknown
  method       TEXT
  PRIMARY KEY (food_id, nutrient)

captured_food_portions
  id      TEXT PRIMARY KEY
  food_id TEXT NOT NULL
  label   TEXT NOT NULL
  grams   REAL NOT NULL
  source  TEXT
```

Rules:

- `captured_foods` and the seed foods live behind **one read API**. A search
  returns both; the UI does not know which kind it got. The seed list moves into
  the same tables by the importer (S1.5), which this slice depends on.
- A captured food is **never** written into the seed file. Fixtures stay
  fixtures.
- `image_path` points at a file under `data/evidence/`, not a data URL in the
  database.
- Deleting a captured food that a recipe version references is blocked; archive
  instead (rule 5 of DATA-MODEL).

---

## 7. Trust rules (non-negotiable)

These are the same rules the rest of the product already lives by. They are
repeated here because capture is where a fabricated number would enter.

1. **The model proposes, the engine disposes.** A proposal is data, not a
   result. `resolve` re-derives every gram and every per-100 g value.
2. **Nothing is stored without confirmation.** A prefilled value is a
   suggestion. The user confirms or edits (D-020).
3. **A basis is always declared.** Per 100 g, per serving or per pack, and the
   conversion is shown.
4. **Unknown is a valid answer.** "Not on the label" becomes `unknown`, not zero
   and not a guess (D-007).
5. **Adjustments are diffs.** Any changed nutrient is shown against its
   reference with a rationale, and is revertible (D-016).
6. **Confidence is not the model's opinion.** It comes from evidence quality:
   exact barcode match > labelled value > parsed label > free text.
7. **Evidence is kept.** The image, the raw OCR text and the raw model response
   are stored with the record so a number can be traced later.

---

## 8. Interface design

Applies the `ui-ux-pro-max` rule set and the `frontend-design` principles to
NutriPlan's existing tokens. No new palette; the theme layer already supports
mode, accent and motion.

### 8.1 The capture sheet

One sheet, five entry tiles, one review panel.

```
┌──────────────────────────────────────────────┐
│  Add food                            Cancel ✕ │
│                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐            │
│  │  ▣    │ │  ▤    │ │  ✎    │  ← 44 px+    │
│  │ Scan   │ │Photo   │ │ Type   │            │
│  └────────┘ └────────┘ └────────┘            │
│  ┌────────┐ ┌────────┐                       │
│  │  ⊞    │ │  ☰    │                       │
│  │Barcode │ │Manual  │                       │
│  └────────┘ └────────┘                       │
│                                              │
│  ── or search ──────────────────────────     │
│  [ paneer, palak, dal…                    ]  │
└──────────────────────────────────────────────┘
```

- **One primary action per screen.** The sheet's job is to pick a method; the
  review screen's job is to confirm.
- **Icons, not emoji.** Use the existing icon set in `src/components/icons.tsx`.
- **Cancel and back are always reachable** (`escape-routes`).
- **Touch targets** 44 pt minimum with 8 px gaps, matching the plan board's
  current row targets.
- **The sheet is a sheet, not a page**, so the user never loses the recipe they
  were editing.

### 8.2 Review screen

```
┌──────────────────────────────────────────────┐
│  Review before saving                  Back  │
│                                              │
│  Paneer, crumbled             [ change food ]│
│  200 g · 1 katori · 265 kcal/100 g           │
│                                              │
│  ┌ Energy      265 kcal   known    ───────┐ │
│  ├ Protein      18.3 g    known    ───────┤ │
│  ├ Fat          20.1 g    known    ───────┤ │
│  ├ Vit B12       0.4 µg   unknown  ─────── │ │
│  └ ...                                       │
│                                              │
│  ⚠ 3 values came from the label and need     │
│    your check.                               │
│                                              │
│  Add to:  (•) This recipe   ( ) Library      │
│                                              │
│  [ Cancel ]            [ Confirm and add ]   │
└──────────────────────────────────────────────┘
```

Rules from the rule set, made concrete:

- **Errors live next to the field**, not in a summary at the top
  (`error-feedback`). A missing quantity is flagged on the quantity row.
- **Async feedback**: the Confirm button shows a pending state and is disabled
  while the capture resolves (`loading-buttons`). A slow capture shows a
  skeleton, not a blank (`progressive-loading`).
- **Status is never colour alone.** Coverage and adjustment warnings carry an
  icon and words (`color-not-only`). This also applies to the yellow/red
  overflow work in `build/PLAN.md` S8.
- **No layout-shifting press states**; press feedback changes colour or opacity
  only (`press-feedback`).
- **Reduced motion**: the sheet slides in, it does not spring. Under
  `data-motion="reduced"` it fades or appears instantly.
- **Keyboard**: focus moves into the sheet on open, Escape closes it and
  returns focus to the trigger, Tab order matches the visual order, and the
  review table is a real table with row headers so a screen reader can follow
  it.
- **Empty state**: a barcode with no match says what to do next, in the
  interface's voice — "Not in Open Food Facts. Add it manually or photograph
  the label."
- **Copy is specific.** "Confirm and add", not "Submit". The same verb is used
  for the same action everywhere.

### 8.3 Where the sheet opens from

| From | Destination preselected |
|---|---|
| Recipe builder, an ingredient row | This recipe |
| Plan board, a slot | That plan slot |
| Diary | Today |
| Recipes library, "new food" | Library |

---

## 9. Acceptance criteria

- [ ] A food can be created manually, used once, and found again by search.
- [ ] A food can be created without any nutrient value, and every nutrient then
      shows `unknown`, never 0.
- [ ] A barcode resolves to an OFF product, and the stored values carry the
      OFF source code and the label's basis.
- [ ] A label photo produces a proposal the user must confirm; the raw text and
      the image are stored with the record.
- [ ] A text description produces one candidate per food, and an ambiguous
      quantity is `unknown` rather than guessed.
- [ ] Every candidate is re-resolved through `toGrams`; no capture path can
      store a gram weight the engine did not compute.
- [ ] A captured item can be placed in a recipe, promoted to a recipe, or made
      into a pinned component, and the result is indistinguishable from a
      manually entered one.
- [ ] Placing a captured item in a plan does not create an empty plan row when
      the request is rejected.
- [ ] A captured food in use is archived, not deleted.
- [ ] Review is reachable, cancellable and keyboard-operable from every entry
      method.

---

## 10. Non-goals

- Meal photo estimation (see §4.5).
- Voice input. It is a text front end, not a new pipeline.
- Recipe import from a URL or pasted text. Deferred until the recipe format is
  settled (patch §7.8).
- A general-purpose food database. We consume databases; we do not compete.
- Editing a captured food's nutrients inline as a *primary* workflow. It is a
  correction path, not data entry.
- Multi-user capture. One local user until accounts exist.

---

## 11. Slices

| Slice | Appetite | Depends on | Done when |
|---|---|---|---|
| **S6.1 Manual capture** | 3 days | Foods in the DB (S1.5) | Manual food → use once → searchable later |
| **S6.2 Barcode** | 3–4 days | OFF API, S6.1 | Barcode → review → confirmed record with basis |
| **S7.1 BYO LLM plumbing** | 1 week | — | Provider + model selectable, key stored, one call works, eval harness exists |
| **S6.3 Label capture** | 1 week | S7.1, S6.1 | Label photo → proposal → diff → confirm |
| **S6.4 Text capture** | 3–4 days | S7.1, S6.1 | Description → candidates → confirm |
| **S6.5 Destinations** | 1 week | S6.1, S6.2 | Ingredient / recipe / component / library, pinned component works |

S6.3 and S6.4 are the same screen with a different adapter; they ship together
in practice even if tracked separately.

---

## 12. Open questions

1. **OFF coverage in India.** How complete is it for packaged foods and
   Indian-language labels? If it is thin, label OCR matters more than barcode.
2. **Duplicate detection.** What counts as the same food — name, barcode,
   source code? Needs a rule before S6.2.
3. **Label OCR: server or device?** A browser can run Tesseract in WASM, but a
   vision model is better and needs a key. This is settled by S7.
4. **Serving size without a weight.** Convert, estimate, or leave unknown?
   Recommendation: leave `unknown` and ask.
5. **How long is evidence kept?** Images and raw model responses are storage;
   a retention rule is needed.
6. **Provisional food lifecycle.** When is a provisional food promoted into the
   shared database, and who checks it? Not in v1 — it stays the user's.
