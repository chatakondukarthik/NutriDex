# NutriPlan — Research Register

**Status:** Active
**Purpose:** the questions we have not answered, what we already know, and what
each answer unblocks.

This is a living document, unlike a research note. Notes are time-stamped
snapshots under `research/notes/`; this file tracks the standing questions. When
a question is answered, it leaves this register and becomes either a note or a
decision record.

**Rule:** every entry says what it blocks. A question that blocks nothing is
curiosity, not research.

---

## 1. What we already know

Established during discovery, before the first line of code. Recorded here so it
is not re-researched.

### 1.1 Data licences decide the architecture

| Source | Licence | What it means for us |
|---|---|---|
| USDA FoodData Central (SR Legacy, Foundation) | Public domain (CC0) | Ingest freely, including bulk |
| INDB (Indian Nutrient Databank) | Recorded as CC BY 4.0 | Primary Indian source, attribution required. **Verify against the published repository before bulk import.** |
| IFCT 2017 (NIN Hyderabad) | Copyrighted, no open licence | Reach it **through** INDB rather than ingesting the PDF |
| CoFID (McCance & Widdowson) | Open Government Licence v3.0 via the GOV.UK Excel file | Commercial use permitted, attribution required |
| Quadram Institute CoFID API | CC BY-NC-SA | **Non-commercial.** Do not use, even though it is the convenient interface |
| Ciqual (ANSES) | Licence Ouverte 2.0 (Etalab) | Usable with attribution |
| Open Food Facts | ODbL, share-alike | Search and prefill only. Do not bulk-ingest into our own tables |
| Nutritionix / Edamame / FatSecret | Commercial terms | Generally forbid storing their data. Lookup-only at best |

The trap worth remembering: **the same dataset can have two licences depending
on how you reach it.** CoFID through GOV.UK is OGL; CoFID through the Quadram
API is non-commercial. The delivery mechanism is part of the licence.

### 1.2 Accuracy is bounded, and the product must say so

| Layer | Realistic accuracy | Product consequence |
|---|---|---|
| Energy and macros | ~10% | Trustworthy enough for progress bars |
| Common micronutrients (iron, calcium, vitamin C) | ~25% | Show as estimates, show coverage |
| Trace nutrients (B12, vitamin D, folate) | Directional only | Never present as precise |

Population-level composition tables describe *average* food. Individual
ingredients vary more than the tables admit. The product promise is
**transparency**, not precision.

### 1.3 Cooking loss is the largest silent error

USDA FNDDS does not model fat gain or loss in recipes, because the oil is
already an input. The same reasoning is adopted in D-022 and D-026: an operation
changes nothing unless the user records an output mass.

### 1.4 A generic Atwater formula cannot validate energy

USDA applies food-group-specific factors (vegetables 2.44 / 8.37 / 3.57,
legumes 3.47 / 8.37 / 4.07, and so on). A single formula drifts 5–15% on some
foods. The engine's energy check is therefore a **gross-error detector** at a
20% tolerance, not an accuracy score. This is why Rajma drifts −12.4% in the
test suite and that is correct behaviour.

### 1.5 Prior art for blocks

Galley ("Components"), ESHA Genesis (loss/target model), FoodCore, `recipe_grid`
and Cooklang all separate a recipe into process steps with inputs and outputs.
D-021 is not an invention; it is the common shape.

---

## 2. Open questions

Each question has an ID, a status, and what it blocks. Statuses: **Open**,
**In progress**, **Blocked**, **Answered** (then it moves to a note).

### Q-001 — Can we actually ingest INDB, and under what terms?

**Status:** Open · **Blocks:** S1.5 (replacing the seed dataset)

The seed file exists to prove the engine. Before any real user sees the app, the
20 fixtures must be replaced by a licensed, versioned import.

What to establish:

1. The current canonical location of INDB and its stated licence.
2. Whether the licence covers redistribution of derived values inside an app.
3. What the record structure is, and whether it distinguishes raw from cooked.
4. Whether IFCT-derived records are separable, since IFCT itself is not openly
   licensed.

**Done when:** a written licence note exists in `research/notes/`, and the
importer reads from a pinned snapshot with the attribution string stored
alongside it.

### Q-002 — What are the real Indian household portions?

**Status:** Open · **Blocks:** S1 accuracy, and the credibility of every entry

No public dataset provides `1 katori`, `1 medium onion`, `1 tbsp` in grams for
Indian cooking. Every food currently carries a hand-set value with the source
`household measure`, which is honest but not verified.

Options, in order of preference:

1. Find a published Indian household-measures table.
2. Derive from density plus a measured vessel volume (a katori is ~150 ml, but
   the *filled* mass differs per food).
3. Measure a small set ourselves and document the method.

**Done when:** each portion has a citable source, and portions without one are
marked as assumptions in the UI.

### Q-003 — What should the daily target actually be?

**Status:** Partly answered · **Blocks:** custom target overrides

`src/lib/targets.ts` now derives targets from the stored profile: Mifflin–St Jeor
or Katch–McArdle for energy, a pace expressed as a share of body weight, visible
safety rails, and g/kg protein by goal (D-030, D-031). Each target also carries a
guidance role, so a day and a week are judged in the right window (D-032). What
is still open is the *quality* of the numbers, not their plumbing.

Reference point: ICMR-NIN 2020 Recommended Dietary Allowances for Indians. This
matters more than a generic international table because the population's intake
patterns differ — iron and calcium in particular.

Answered:

- **Direction.** Each nutrient's direction comes from the vocabulary, and its
  role decides whether a day or a week judges it. A nutrient cannot be a ceiling
  on one screen and a minimum on another.
- **Energy adjustment.** A percentage of body weight per week, not a fixed kcal
  delta, with a floor and deficit/surplus caps. A capped plan reports the
  effective rate instead of the requested one.

Still open:

- One target per nutrient, or a range? A range changes the bar semantics, so it
  is deliberately not shipped.
- Are `max` nutrients (sodium, sugar, fat) limits or targets? They are modelled
  as limits, but the evidence for a hard daily ceiling is weak for fat.
- What happens when a target is unknown for a user's profile? Today the seed
  table always returns a value banded by sex and age; a real dataset will have
  holes.
- Are the rails (1,200/1,500 kcal, 25 % deficit, 15 % surplus) the right numbers
  for an Indian population, and should a clinician be able to override them?
- The micro values are still unverified fixtures. They need the same source
  review as the food data before any of them can be called a recommendation.

### Q-004 — How does search work when the vocabulary is multilingual?

**Status:** Open · **Blocks:** S1.5, and usability for anyone who does not type English

Current search is substring matching over name plus aliases. It fails on
transliteration (`paneer` / `panir` / `পনির`), on compound queries (`dal chawal`),
and on spelling variation.

What to establish:

1. Whether to normalise transliterations (a soundex-like key per script) or
   maintain an explicit synonym table.
2. Whether Hindi/regional names come from a source dataset or are user-contributed.
3. Whether the MVP can ship English plus romanised Hindi and defer scripts.

### Q-005 — How good is Open Food Facts coverage for Indian packaged food?

**Status:** Open · **Blocks:** barcode scan (Next), not the MVP

ODbL means we can use it for lookup and prefill but must not absorb it into our
tables without honouring share-alike. Coverage of Indian brands is believed to
be sparse, which would make barcode scanning unreliable exactly where it would be
most useful.

**Done when:** a sample of 50 common Indian packaged products is checked, and the
hit rate is recorded.

### Q-006 — Do we need nutrient retention factors in v1?

**Status:** Open · **Blocks:** nothing yet (deliberately deferred by D-026)

USDA Table of Nutrient Retention Factors, Release 6 is public domain. It would
let us model vitamin loss during cooking.

Deferred because using **cooked-state records** from IFCT/INDB gives a better
answer with less machinery. Revisit when the product tracks vitamins at a
fidelity where the difference is visible.

### Q-007 — How do we handle bioaccessibility?

**Status:** Open · **Blocks:** nothing (explicitly out of scope for v1)

Iron from spinach is not the same as iron from liver once phytate and cooking are
considered. v1 reports the composition-table value and says so. Any adjustment
would need evidence, and the evidence is contested.

Recorded so the limitation is a decision, not an oversight.

### Q-008 — What is the actual yield factor for Indian cooking methods?

**Status:** Open · **Blocks:** D-026 tier 2 (reference yield factors)

The precedence order prefers a user-measured output mass. Tier 2 — a reference
yield factor per food and operation — needs a source. Candidates: USDA yield
data, and IFCT's cooked-state values used to back out an implied factor.

Until then, tier 3 applies: no adjustment, disclosed.

---

## 3. Questions we have deliberately closed

Not every open question should be researched. These were considered and closed,
with the reason, so they are not reopened by accident.

| Question | Closed because |
|---|---|
| Should we build our own food composition database? | No. We consume databases; we do not compete with them. |
| Should we track 150 nutrients? | No. 18, chosen because they are what the UI shows. Adding more is a data change. |
| Should AI compute the totals? | No. AI interprets; the engine calculates (D-009). |
| Should we parse cooking instructions into steps? | Not in v1. Store them as evidence (D-017). |
| Should missing nutrients be zero-filled for a cleaner UI? | Never. `unknown` is a feature. |

---

## 4. How to use this register

- Start a slice by reading §2 for questions that block it.
- Answering a question produces a note in `research/notes/YYYY-MM-DD-topic.md`,
  and — if it changes what we build — a decision record.
- Then remove the question from §2 and add a line to §1 or §3.
- If a question has been Open across two slices, either it is not really blocking
  anything (close it) or the slice is blocked (say so).
