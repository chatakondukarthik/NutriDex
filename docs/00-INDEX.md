# NutriPlan — Documentation Index

This is the only entry point. If something is not linked here, it does not
exist.

The system itself is described in [`_SYSTEM.md`](_SYSTEM.md). Read that once;
it explains why there are four kinds of document and when to write each.

---

## Start here

| Document | Question it answers |
|---|---|
| [`product/PRODUCT.md`](product/PRODUCT.md) | What is this, for whom, and what is the one loop? |
| [`product/SCOPE.md`](product/SCOPE.md) | What is in, what is next, what will we never do? |
| [`build/PLAN.md`](build/PLAN.md) | What are we building, in what order, and when is it done? |

## Decisions

| Document | Question it answers |
|---|---|
| [`decisions/DECISIONS.md`](decisions/DECISIONS.md) | Why did we choose this? |

The full register is D-001 onward. Decisions are immutable: reversing one
means writing a new record that supersedes it.

## Reference — how it works today

| Document | Question it answers |
|---|---|
| [`reference/NUTRITION.md`](reference/NUTRITION.md) | How are nutrient values calculated? |
| [`reference/DATA-MODEL.md`](reference/DATA-MODEL.md) | What are the entities? |
| [`reference/USER_SCHEMA.md`](reference/USER_SCHEMA.md) | How to add accounts later without a rewrite |
| [`reference/STACK.md`](reference/STACK.md) | What runs this, and why? |
| [`reference/TESTING.md`](reference/TESTING.md) | What is tested, how, and what is still manual? |

Reference docs are updated in the same commit as the code they describe.

## Research — what we do not know yet

| Document | Question it answers |
|---|---|
| [`research/RESEARCH.md`](research/RESEARCH.md) | What must we learn, and what have we already learned? |
| [`research/notes/2026-11-15-fud-ai-and-llm-providers.md`](research/notes/2026-11-15-fud-ai-and-llm-providers.md) | What does a shipping open-source tracker do for capture and AI providers? |

## Specifications — the source documents

| Document | What it is |
|---|---|
| [`spec/NutriPlan_MVP_Product_Specification_v0.3.md`](spec/NutriPlan_MVP_Product_Specification_v0.3.md) | Decision register and product spec (source of truth) |
| [`spec/NutriPlan_Product_Blueprint_MVP_v0.2.md`](spec/NutriPlan_Product_Blueprint_MVP_v0.2.md) | Original blueprint (superseded structurally, still useful) |
| [`spec/PATCH_recipe_and_ai.md`](spec/PATCH_recipe_and_ai.md) | Proposed D-013…D-026 and the §7 recipe replacement |
| [`spec/RECIPE_FLOWCHART.md`](spec/RECIPE_FLOWCHART.md) | Recipe as a flowchart of process blocks (R1–R6) |
| [`spec/INGREDIENT_CAPTURE.md`](spec/INGREDIENT_CAPTURE.md) | One capture pipeline; ingredient, recipe and sub-ingredient as destinations |
| [`spec/BYO_LLM.md`](spec/BYO_LLM.md) | Bring-your-own LLM: providers, keys, prompts, evaluation |

---

## Current state

| Slice | State |
|---|---|
| S0 — Skeleton | Done |
| S1 — Food | Done (seed data, not production data) |
| S2 — Recipe | Done |
| S3 — Plan | Done |
| S3.5 — Theme and transparency | Done |
| S4 — Trust and ship | In progress |
| S5 — Testing | Done (foundation; end-to-end pending) |
| S6 — Ingredient capture | Planned |
| S7 — Bring-your-own LLM | Planned |
| S8 — Status colour | Planned |

See [`build/PLAN.md`](build/PLAN.md) for what each slice means.
