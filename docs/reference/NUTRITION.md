# NutriPlan — Nutrition Calculation Contract

**Status:** Implemented for S1 and S2
**Code:** `src/lib/nutrition/` (pure, no I/O) · **Tests:** `tests/engine.test.ts`, `tests/recipe.test.ts`
**Decisions:** D-007, D-008, D-009, D-025, D-026

This is the contract the engine implements. If the code and this document
disagree, one of them is a bug.

---

## 1. The pipeline

Six steps. Only one is arithmetic.

```
1. resolve   ingredient line → nutrient profile per 100 g
2. convert   quantity + unit → grams
3. scale     per 100 g → the actual gram weight
4. sum       contributions → totals
5. adjust    yield (mass) and, later, retention
6. report    totals + status + coverage
```

The engine is a pure function over plain data: no database, no network, no
framework. That is deliberate — it is the part most likely to be wrong, so it
is the part that is easiest to test.

---

## 2. Data shapes

```ts
type NutrientStatus = "known" | "estimated" | "unknown";

interface NutrientValue {
  amount: number | null;   // per 100 g edible portion; null = unknown
  status: NutrientStatus;
  source: string;
  sourceFoodCode?: string;
}

type NutrientProfile = Record<NutrientCode, NutrientValue>;
```

Two rules that everything else depends on:

1. **`null` means unknown.** It never means zero. A food that has not been
   analysed for iron has `FE.amount === null`, not `0`.
2. **Every value carries a source.** There is no such thing as an unattributed
   number in this system.

The vocabulary is the 18 nutrients in `NUTRIENT_CODES`, mapped to INFOODS
tagnames. Adding a nutrient is a data change: the profile is a record keyed by
code, so nothing breaks and no migration runs.

---

## 3. Unit conversion

`toGrams(food, quantity)` is the highest-risk function in the product. A wrong
conversion makes every downstream number wrong while still looking plausible.
It therefore never guesses silently.

| Unit | Conversion | Failure mode |
|---|---|---|
| `g`, `kg` | direct | — |
| `ml`, `l` | `× densityGPerMl` | If no density, assumes 1 g/ml **and returns a note** |
| `portion` | `× portion.grams` | Unknown portion is a hard failure |

Rules:

- A non-positive or non-finite quantity is rejected.
- A missing density produces a visible assumption, not a silent one.
- The resolved gram weight is **stored on the entry**, so a later portion-table
  change cannot rewrite history.

Household portions (`1 katori`, `1 medium`, `1 tbsp`) are per-food data, not a
global table. Indian measures are the highest-leverage data we own, because no
external dataset provides them.

---

## 4. Scaling and summation

```
amount_at_grams = amount_per_100g × grams / 100
```

Nutrients are additive by mass, so contributions sum directly. They are **not**
additive by serving, which is why the internal basis is always per 100 g.

---

## 5. Status and coverage

For each nutrient across a set of contributions:

| Known contributions | Status | Total |
|---|---|---|
| all | `known` | exact |
| some | `estimated` | sum of the known ones — a **lower bound** |
| none | `unknown` | `null` |

```
coverage[nutrient] = { known: n, total: m }
```

A partial total is never scaled up to fill the gap. If 3 of 8 ingredients know
their iron value, the recipe reports the sum of those 3 and says
`known for 3/8`. The UI must show this, not hide it.

This is the single most important honesty mechanism in the product. It is what
makes an estimate trustworthy: the user can see the shape of what is missing.

---

## 6. Yield and retention (D-026)

Two independent effects, never conflated:

| Effect | Changes | Direction of per-100 g |
|---|---|---|
| Moisture loss or gain | the denominator (mass) | values rise |
| Nutrient retention | the numerator (amount) | vitamin values fall |

**Mass — precedence, highest first:**

1. Measured output mass from the user, on the final block → `known`.
2. Reference yield factor for the food and operation → `estimated`, disclosed.
3. No adjustment; raw mass treated as cooked mass → assumption disclosed.

**Nutrients — precedence, highest first:**

1. Prefer a **cooked-state record** where the source publishes one. IFCT and
   INDB both do.
2. Only when a raw record stands in for a cooked preparation is the value
   marked `estimated`.

**Retention factors are deferred.** USDA Table of Nutrient Retention Factors,
Release 6 is public domain and will be used when vitamin fidelity justifies it.
Using cooked-state records gets a better answer with less machinery.

The system never invents a cooking loss. This matches USDA FNDDS, which does
not model fat gain or loss because the oil is already an input.

---

## 7. Recipe composition: blocks (D-021, D-022)

A recipe is an ordered list of **blocks**. A block is inputs + an operation + an
optional output mass. A flat ingredient list is the degenerate single-block
case, so a simple recipe does not pay for the structure.

```
recipe → [block] → [input line] → food profile + grams
```

Three levels, computed bottom-up:

| Level | What it is | Where it is shown |
|---|---|---|
| line | one ingredient at its resolved weight | ingredient rows |
| block | the sum of its lines | step subtotal |
| recipe | the sum of its blocks | total, per serving, per 100 g |

Blocks are rolled up independently so each step can show a subtotal, then
combined with `combine()`, which preserves coverage across blocks: a nutrient
is `known` for the recipe only when every block knows it, and the coverage
counter sums the line counts rather than restarting at the block boundary.

**An operation is a label.** `fry`, `boil`, `dice` change no number by
themselves (D-022). They exist for the method text, the step subtotal, and
later for selecting a cooked-state record.

### The yield basis

The recipe's cooked mass is the output of the **final block**, not the sum of
all block outputs. Earlier blocks are intermediate: nobody weighs the pan
between every stage, and an intermediate mass says nothing about the finished
dish.

| Basis | Condition | per-100 g |
|---|---|---|
| `measured` | the final block has an output mass | computed from it |
| `partial` | only an intermediate block does | not shown |
| `none` | nothing was weighed | not shown; totals unaffected |

A measured output mass changes only the per-100 g denominator. The absolute
amount of protein in the pan does not change because water boiled off.

The basis is stored with the version and rendered as plain language by
`yieldNote()`, because D-026 requires the assumption to be disclosed, not
implied.

---

## 8. Energy

The source's stated energy value wins. Never recompute it as the source of
truth.

`atwaterKcal()` exists as a **sanity check**: `protein×4 + fat×9 + available
carb×4 + fibre×2`, where available carb excludes fibre. It catches a food
resolved to the wrong record, which shows up as a 2× drift.

It cannot validate a value. USDA uses food-group-specific Atwater factors
(vegetables 2.44/8.37/3.57, legumes 3.47/8.37/4.07, and so on), and different
tables use different fibre conventions. A generic formula will be off by 5–15%
on some foods. The test tolerance is therefore 20%, and it is described as a
gross-error detector, not an accuracy score.

---

## 9. What this deliberately does not do

- **Model cooking loss without evidence.** No fabricated yield factors.
- **Treat missing as zero.** Ever.
- **Sum servings.** Internal basis is per 100 g.
- **Recompute stored history.** Entries store their resolved grams; recipe
  versions store their computed snapshot (D-024).
- **Model bioaccessibility.** Iron from spinach is not adjusted for phytate in
  v1. It is a known limitation, not an oversight.
- **Track 150 nutrients.** Eighteen, chosen because they are what the UI shows.

---

## 10. Test contract

`tests/engine.test.ts` asserts:

- Omitted nutrients are unknown, never zero.
- Scaling preserves unknown as unknown.
- Rollup sums by mass and flags partial coverage.
- A nutrient is `known` only when every contribution knows it.
- An unknown ingredient does not suppress a known one.
- Servings divide totals but preserve coverage.
- Fibre is counted at 2 kcal/g.
- Energy drift is under 20% for every seed food with stated energy ≥ 50 kcal.
- Millilitres use density; missing density is disclosed, not assumed silently.
- Unknown portions fail loudly.
- Search finds foods by Indian name.

`tests/recipe.test.ts` asserts the composition contract:

- Each block gets its own subtotal; the recipe total is the sum of blocks.
- A single block behaves exactly like a flat ingredient list.
- Coverage is combined across blocks, not lost at the boundary.
- A measured output mass changes per-100 g but not the total.
- The yield basis is `measured`, `partial` or `none`, and is described in
  plain language.
- A nonsense output mass is ignored rather than divided by.

---

## 11. Worked example

```
Block 1 "Grate":  paneer 100 g      → 265 kcal, 18.3 P, 20.8 F, 1.2 C
Block 2 "Sauté":  mustard oil 5 g   →  45 kcal,  0.0 P,  5.0 F, 0.0 C
                  onion 50 g        →  22 kcal,  0.6 P,  0.1 F, 5.0 C
                  tomato 50 g       →   9 kcal,  0.5 P,  0.1 F, 2.0 C
Recipe total                        → 341 kcal, 19.4 P, 26.0 F, 8.2 C
Block 2 output, measured 200 g      → 170 kcal / 100 g
2 servings                          → 170 kcal / serving
```

The 200 g is the output of the final block. Weighing block 1 as well would
make the basis `measured` with the same recipe-level figure; weighing only
block 1 would make it `partial` and no per-100 g would be shown.

Atwater check: `19.4×4 + 26×9 + 8.2×4 = 344` vs 341 stated — within tolerance.

Iron here would report `known for 2/4` if paneer and tomato carry values and
oil and onion do not. That is the correct output, not a bug.
