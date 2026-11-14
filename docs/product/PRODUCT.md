# NutriPlan — Product

**Status:** Active

---

## What it is

A nutrition-first meal planner. You build meals from real ingredients, see what
they actually contain, put them in a week, and watch the day fill up.

Not a calorie counter. Not a recipe website. The difference is that the numbers
are the point: every meal you plan tells you what it contributes, and every
number can be traced back to where it came from.

## Who it is for

One person, planning their own week, cooking Indian food at home, who wants to
know whether what they are planning actually meets their needs — without
weighing every ingredient on a laboratory scale.

The v1 food domain is deliberately narrow: the user's own diet plus common
Indian foods. Broad coverage is unbounded; a narrow domain is shippable.

## The one loop

Everything in the MVP serves this loop. If a feature does not make it shorter
or more trustworthy, it is not in the MVP.

```
Find a food  →  put it in a recipe (or a slot)
             →  see its nutrition
             →  put the recipe in a plan
             →  see the day's progress against a target
```

Recipe blocks, nutrient provenance and AI estimation are all in service of this
loop. None of them are the product.

## What makes it different

Three claims, each of which is a design constraint:

1. **Every number has a provenance.** Sourced, calculated, or estimated — and
   the user can see which.
2. **Missing data is visible.** A nutrient is `known`, `estimated`, or
   `unknown`. It is never silently zero. A recipe tells you it knows iron for
   6 of 8 ingredients.
3. **Saved things do not move.** A recipe version and a plan are immutable
   snapshots. Correcting a food record does not silently change last week's
   plan.

## Principles

- **Honest over precise.** We do not claim more accuracy than the data
  supports. Population averages vary by 10–30% for micronutrients.
- **The user is the authority on their food.** The system suggests; the user
  confirms. Nothing is adjusted silently.
- **One model, adaptive interface.** A simple recipe is a degenerate case of a
  complex one, not a separate product.
- **The loop works without AI.** AI enhances a working product; it is not a
  prerequisite for one.

## Non-goals

- Medical or therapeutic advice.
- A social network, a recipe blog, or a content site.
- Tracking exercise, weight, or anything outside food planning.
- Being a food database. We consume databases; we do not compete with them.

## Where the detail lives

| Topic | Document |
|---|---|
| Scope | [`SCOPE.md`](SCOPE.md) |
| Build order | [`../build/PLAN.md`](../build/PLAN.md) |
| Decisions | [`../decisions/DECISIONS.md`](../decisions/DECISIONS.md) |
| Calculation | [`../reference/NUTRITION.md`](../reference/NUTRITION.md) |
