# NutriPlan — Scope

**Status:** Active
**Rule:** one home per item. Promotion from *Next* to *In* requires a decision
record.

---

## In — MVP

| Area | Item | Why it is here |
|---|---|---|
| Accounts | Email or Google sign-in, one profile | Progress bars need a person |
| Profile | Age, sex, activity level, goal | Minimum needed to derive a target |
| Food | Search by name, English plus common Indian names | Entry point to everything |
| Food | Add with a portion (g, ml, katori, piece) | Portions are where accuracy lives |
| Food | Per-100 g and per-portion nutrition, with coverage | The "is this real?" answer |
| Recipe | Ordered blocks: inputs + operation + output | The agreed model (D-021) |
| Recipe | Per-block subtotal, recipe total, per-serving | The core calculation |
| Recipe | Instructions, yield, servings | Makes it a recipe, not a list |
| Recipe | Save as immutable version (D-018, D-024) | Plans must stay stable |
| Plan | 7-day grid, four slots per day | The planning surface |
| Plan | Drag a recipe or food into a slot, remove it | The interaction the product is for |
| Plan | Progress bars per nutrient group, live on drop | The feedback loop |
| Plan | Daily targets from the profile | Progress needs a denominator |
| Trust | Coverage indicator | Honesty is a feature |
| Trust | Attribution page and health disclaimer | Required by licence and by law |
| Platform | Mobile-responsive layout | Cooking happens on a phone |

### Shipped so far

- Search, portion conversion, per-100 g and per-portion nutrition, coverage,
  persistence, and the calculation engine. (S1)

---

## Next — designed, not built

| Item | Blocked by |
|---|---|
| Recipe blocks and yield | S2 |
| Immutable recipe versions | S2 |
| Weekly plan and drag-and-drop | S3 |
| AI estimation with per-nutrient diff (D-016) | The loop shipping and being measured |
| Label photo / OCR for packaged foods | The estimation contract |
| Save a block as a reusable component, pinned (D-023) | S2 |
| Recipe variants ("duplicate & customise") | Versioning |
| Custom targets and target editor | Profile targets |
| Actual consumption logging, planned vs actual | S3 |
| Copy a day or a week | S3 |
| Barcode scan for packaged goods | Assessing Open Food Facts coverage in India |
| Retention factors for sensitive vitamins (D-026) | Nutrient fidelity mattering enough |

---

## Later — known, undesigned

- Shopping list generated from a plan
- Multi-language UI (Hindi, regional names)
- Sharing a recipe or a plan
- Nutrition trends over weeks and months
- Households and multiple eaters
- Recipe import from a URL or pasted text
- Offline mode
- Photo-based meal logging

---

## Never — rejected, with the reason

| Item | Reason |
|---|---|
| Manual nutrient entry as a primary path | Contradicts D-007; produces unverifiable data |
| Live-cascading sub-recipes | Contradicts D-018's snapshot rule; needs cycle detection |
| Medical or therapeutic advice | Regulatory exposure; we are a planning tool |
| Scraping commercial nutrition APIs into our DB | Their terms forbid storage |
| A second "simple recipe" model | One adaptive model (D-013, D-014) |
| A general-purpose food database | We consume databases; we do not compete with them |
