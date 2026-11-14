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
| [`reference/STACK.md`](reference/STACK.md) | What runs this, and why? |

Reference docs are updated in the same commit as the code they describe.

## Research — what we do not know yet

| Document | Question it answers |
|---|---|
| [`research/RESEARCH.md`](research/RESEARCH.md) | What must we learn, and what have we already learned? |

## Specifications — the source documents

| Document | What it is |
|---|---|
| [`spec/NutriPlan_MVP_Product_Specification_v0.3.md`](spec/NutriPlan_MVP_Product_Specification_v0.3.md) | Decision register and product spec (source of truth) |
| [`spec/NutriPlan_Product_Blueprint_MVP_v0.2.md`](spec/NutriPlan_Product_Blueprint_MVP_v0.2.md) | Original blueprint (superseded structurally, still useful) |
| [`spec/PATCH_recipe_and_ai.md`](spec/PATCH_recipe_and_ai.md) | Proposed D-013…D-026 and the §7 recipe replacement |

---

## Current state

| Slice | State |
|---|---|
| S0 — Skeleton | Done |
| S1 — Food | Done (seed data, not production data) |
| S2 — Recipe | Done |
| S3 — Plan | Not started |
| S4 — Trust and ship | Not started |

See [`build/PLAN.md`](build/PLAN.md) for what each slice means.
