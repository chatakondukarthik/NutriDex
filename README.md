# NutriPlan

Plan your meals. Know what is in them.

A nutrition-first meal planner: build a recipe from real ingredients, see what
it actually contains, put it in a week, and watch the day fill up.

**Status:** S0–S3.5 done; S4 (trust and ship) in progress. Food entry, recipes,
the weekly plan, theming, the target explanation and total export/import work
end to end. See [`docs/build/PLAN.md`](docs/build/PLAN.md). The design system is
the Thali Ledger — [`docs/design/THALI-LEDGER.md`](docs/design/THALI-LEDGER.md).

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # engine, recipes, plan, profile, targets, persistence, security
npm run build    # production build
```

No database service, no Docker, no API keys. Node ships SQLite, so the app
runs from a clean checkout.

By default the app answers only on this machine: a request addressed to a LAN
hostname gets a 403. That is the `local` request gate, not a login system —
see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) before opening it up.

---

## Deploy

The app ships as a standalone Node server and a three-stage Docker image, with
a reverse-proxy configuration for nginx or Caddy, a health endpoint, a single
data volume, and backup/restore steps.

```bash
cp .env.example .env
docker compose up -d --build
curl -s http://127.0.0.1:3000/api/health   # {"ok":true}
```

There is **no authentication by design**. Put TLS and a real boundary (proxy
auth, VPN, or `NUTRIPLAN_GATE=token`) in front of a public deployment.
Configuration, gate modes, reverse-proxy examples, backups and residual risks
are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## What works today

- Search 20 seeded foods by name or Indian name (`palak`, `doodh`, `dal`).
- Add a food with grams, millilitres, or a household portion (`1 katori`, `1 medium`).
- See the day's nutrition against a target, per nutrient group.
- See **coverage**: which nutrients are known and which are not.
- Every value carries its source; missing values show as `unknown`, never `0`.
- Build a recipe in five sections: ingredients, method, instructions, yield, review.
- Group ingredients into steps (blocks); each step gets its own subtotal.
- Record a measured output weight; per-100 g changes, the total does not.
- Save immutable versions. Editing saves a new version; old versions and the
  plans that used them never change.
- Start from a preset (paneer bhurji, dal tadka, rajma masala) and save your own
  copy.
- Plan a week: four slots a day, recipes or foods placed by tap or drag.
- Move a placed item between slots by its handle, or hold Alt while dropping to
  copy it. The copy button puts it back in the palette with the same quantity.
- Pick which version of a recipe to place. Every version is offered, labelled and
  grouped under its recipe.
- Watch a day's energy bar and the full nutrient panel move as you plan, with no
  reload.
- Read the plan panel as a **day** or a **week**. A day judges energy and protein;
  the week judges fibre, vitamins and the limits too.
- Planned recipes are pinned to a version. Editing the recipe later leaves the
  planned week alone.
- Set a profile; daily energy and protein targets are derived from it.
- Give a body-fat percentage to switch the energy equation to lean mass, and
  choose a gentle/steady/fast pace. The profile page shows the equation, the
  rails and the resulting rate, live.
- Switch light/dark/system, four accents and motion from `/settings`. The choice
  is a cookie, applied before paint.
- Skeletons on every route while data loads.
- Read `/about` for the equation, the rails, the data sources and the health
  disclaimer, or a 404 page that still gets you back to the diary.

## What does not work yet

- Custom target overrides (the profile derives them)
- Logging what was actually eaten against the plan
- Accounts (there is one implicit local user)
- Any AI feature
- Real data: the seed file is a fixture, not the production dataset

---

## Repo layout

```
src/
  app/                 Next.js routes, loading skeletons and server actions
  components/          UI, including the token-driven theme controls
  lib/
    nutrition/         the calculation engine — pure, tested, no I/O
    plan.ts            week math and plan rollups — pure, tested, no I/O
    profile.ts         profile shape, energy equations, pace and rails
    targets.ts         derived targets, guidance roles, day/week assessment
    theme.ts           theme tokens, accents and cookie helpers
    data/              seed foods and preset recipe templates
    db/                SQLite persistence (thin)
docs/                  product and technical memory
tests/                 engine, recipe, plan, profile, target and repo tests
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
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Hosting, gate modes, reverse proxy, backups |

Specifications live in [`docs/spec/`](docs/spec/).
