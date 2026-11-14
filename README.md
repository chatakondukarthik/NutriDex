# NutriPlan

Plan your meals. Know what is in them.

A nutrition-first meal planner: build a recipe from real ingredients, see what
it actually contains, put it in a week, and watch the day fill up.

**Status:** walking skeleton. The calculation engine and food entry work. Recipes
and planning are next (see [`docs/build/PLAN.md`](docs/build/PLAN.md)).

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 26 engine tests
npm run build    # production build
```

No database service, no Docker, no API keys. Node 26 ships SQLite, so the app
runs from a clean checkout.

---

## What works today

- Search 20 seeded foods by name or Indian name (`palak`, `doodh`, `dal`).
- Add a food with grams, millilitres, or a household portion (`1 katori`, `1 medium`).
- See the day's nutrition against a target, per nutrient group.
- See **coverage**: which nutrients are known and which are not.
- Every value carries its source; missing values show as `unknown`, never `0`.

## What does not work yet

- Recipes with blocks and yield
- The weekly plan and drag-and-drop
- Accounts (there is one implicit local user)
- Any AI feature
- Real data: the seed file is a fixture, not the production dataset

---

## Repo layout

```
src/
  app/                 Next.js routes and server actions
  components/          UI
  lib/
    nutrition/         the calculation engine — pure, tested, no I/O
    data/              seed foods
    db/                SQLite persistence (thin)
docs/                  product and technical memory
tests/                 engine tests
```

The engine in `src/lib/nutrition/` is the heart of the product. It is a pure
function over plain data: no database, no network, no framework. That is
deliberate — it is the part most likely to be wrong, so it is the part that is
easiest to test.

---

## A note on data honesty

The seed values are from USDA SR Legacy and IFCT 2017, but they have **not** been
through the verified import pipeline. They exist to prove the engine works.

The product rule they demonstrate is real and permanent:

> A nutrient is `known`, `estimated`, or `unknown`. It is never silently zero.

`unknown` is a first-class state in the data model, the UI, and the tests.

---

## Docs

Start at [`docs/00-INDEX.md`](docs/00-INDEX.md).

| Document | What it is |
|---|---|
| [`docs/product/PRODUCT.md`](docs/product/PRODUCT.md) | Vision and the one loop |
| [`docs/product/SCOPE.md`](docs/product/SCOPE.md) | In / Next / Later / Never |
| [`docs/decisions/DECISIONS.md`](docs/decisions/DECISIONS.md) | The decision register |
| [`docs/reference/NUTRITION.md`](docs/reference/NUTRITION.md) | The calculation contract |
| [`docs/reference/DATA-MODEL.md`](docs/reference/DATA-MODEL.md) | Entities |
| [`docs/build/PLAN.md`](docs/build/PLAN.md) | Slices and definition of done |
| [`docs/research/RESEARCH.md`](docs/research/RESEARCH.md) | Open questions |

Specifications live in [`docs/spec/`](docs/spec/).
