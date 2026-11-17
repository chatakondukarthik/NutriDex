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
| Data | Total export and import as one archive | The user owns the data (D-047) |

### Shipped so far

- Search, portion conversion, per-100 g and per-portion nutrition, coverage,
  persistence, and the calculation engine. (S1)
- Recipe builder with blocks, operations, measured output mass, instructions,
  servings, per-block subtotals, immutable versions with a stored nutrition
  snapshot, and preset templates. (S2)
- A weekly plan: four slots a day, recipes or foods placed by tap or drag,
  inline quantities, per-day energy bars and a full nutrient panel for the
  selected day. Planned recipes are pinned to a version. (S3)
- A profile that derives daily energy and protein targets and picks
  sex- and age-banded reference values for the rest. (S3)
- A complete archive: every user-owned row, evidence images and a checksummed
  manifest in one ZIP, with a checked import that never overwrites silently.
  (S11, D-047)

---

## Next — designed, not built

| Item | Blocked by |
|---|---|
| Ingredient capture — manual food, barcode, label OCR (S6) | Foods moving into the database (S1.5) |
| Bring-your-own LLM: provider, model, key, eval harness (S7) | Nothing; it unblocks label and text capture |
| AI estimation with per-nutrient diff (D-016) | S7.1 |
| Save a block as a reusable component, pinned (D-023) | S6.5 destinations |
| Recipe variants ("duplicate & customise") | Versioning |
| Custom target overrides (the profile derives them today) | Q-003 |
| Actual consumption logging, planned vs actual | S4 |
| Copy a day or a week | The plan shipping and being used |
| Status colour: yellow/red overflow (S8) | A threshold decision |
| Retention factors for sensitive vitamins (D-026) | Nutrient fidelity mattering enough |
| Optional account: Supabase auth-only, no content online (D-048) | A decision on whether an account earns its keep |
| Multi-device: encrypted archive in the user's own storage | The archive proving itself first |

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
| Estimating a plated meal from a photo | Portion size, occlusion and cooking fat are unobservable; a wrong number looks identical to a right one |
| NutriPlan-hosted AI keys | The user brings their own; we would become the provider and the liability |
| Storing a model's nutrient numbers as facts | Breaks D-008/D-009; "estimated" would stop meaning anything |
