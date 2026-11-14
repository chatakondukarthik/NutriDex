# NutriPlan — Decision Register

**Status:** Active
**Rule:** decisions are immutable. Reversing one means writing a new record that
supersedes it, linked both ways. Never edit an accepted record.

---

## How to read this

This file is an **index**, not the record itself. Each entry states what the
decision settles in one line and links to where the full record lives.

Two reasons for that split:

1. The records in `docs/spec/` were agreed before this repo existed and are
   cited by ID in the spec, the code and the tests. Rewriting them here would
   create two sources of truth that drift.
2. An index is scannable. A new engineer should be able to read the table below
   in two minutes and know what has already been settled.

When a decision is made **after** the spec was frozen, its full record is
written in this file under [New records](#new-records-d-027-onward).

---

## Status legend

| Status | Meaning |
|---|---|
| **Agreed** | Settled. Build against it. |
| **Proposed** | Written, argued, not yet ratified. Buildable, but may change. |
| **Superseded** | Replaced by a later record. Kept for the reasoning. |

---

## The register

### Product stance

| ID | Decision | Status | Full record |
|---|---|---|---|
| D-001 | The product is nutrition-first, with room to expand later | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-002 | The interface hides unnecessary nutrition complexity | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-009 | AI interprets; the engine resolves and calculates. AI never overwrites known values | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-019 | AI is required for the designed experience but degrades gracefully | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-028 | The product loop ships before AI | Agreed | [below](#d-028--the-product-loop-ships-before-ai) |

### Food model

| ID | Decision | Status | Full record |
|---|---|---|---|
| D-003 | Layered food model: identity → characteristics → nutrition profile | Agreed (schema open) | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-004 | Unknown attributes are a valid state; defaults and inferences are visible and correctable | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-005 | Some apparent variations are separate food identities or preparation states | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-010 | Show the reference food used when the exact variant is unavailable | Agreed (UI open) | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-011 | Four entry methods converge on one resolution workflow | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-012 | Using a food and saving it to the library are separate actions | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-020 | Packaged-food labels must declare their basis (`per_100g` / `per_serving` / `per_pack`) | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |

### Nutrition calculation

| ID | Decision | Status | Full record |
|---|---|---|---|
| D-007 | Estimates are evidence-led and transparent; an insufficient-evidence state exists | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-008 | Provenance exists at the nutrient level, not the food-record level | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |
| D-025 | One INFOODS vocabulary, 18 tracked nutrients, `unknown` as a first-class state | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-026 | Prefer cooked-state records; adjust yield only with evidence; retention deferred | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |

Implementation contract: [`../reference/NUTRITION.md`](../reference/NUTRITION.md).

### Recipes

| ID | Decision | Status | Full record |
|---|---|---|---|
| D-013 | A recipe is a reusable named unit, not a container for anything eaten once | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-014 | Creation is a staged, resumable five-section flow | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-015 | Each ingredient carries its own characteristics and preparation state | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-016 | AI adjustments are shown as a per-nutrient diff, stored `estimated`, always revertible | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-017 | Instructions are stored as evidence and AI context, not parsed deterministically | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-018 | Edit, version and variant are three distinct change semantics | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-021 | Recipes are ordered **blocks** (inputs + operation + optional output), not flat lists | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-022 | Operations are nutritionally inert without an explicit yield adjustment | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-023 | Reused components are pinned to a version, never live-linked | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-024 | Recipe versions store a computed nutrition snapshot; recalculation is explicit | Proposed | [patch](../spec/PATCH_recipe_and_ai.md) |
| D-006 | Hybrid cooking model: ingredient-level preparation plus recipe-level process | Agreed | [spec §5](../spec/NutriPlan_MVP_Product_Specification_v0.3.md) |

Entities: [`../reference/DATA-MODEL.md`](../reference/DATA-MODEL.md).

### Planning

| ID | Decision | Status | Full record |
|---|---|---|---|
| D-029 | A plan is one Monday-based week; an entry is a food XOR a pinned recipe version | Agreed | [below](#d-029--a-plan-is-a-week-of-pinned-entries) |
| D-030 | Daily targets are derived from a stored profile on read, never stored | Agreed | [below](#d-030--targets-are-derived-from-the-profile) |

### Engineering

| ID | Decision | Status | Full record |
|---|---|---|---|
| D-027 | Node 26 + Next 16 + React 19 + Tailwind 4 + `node:sqlite` + Vitest, no ORM | Agreed | [below](#d-027--stack-for-the-mvp) |

---

## New records (D-027 onward)

These were made while building, after the spec was frozen. They are written in
full here.

---

### D-027 — Stack for the MVP

**Status:** Agreed
**Date:** 2026-11-14

**Context**

The build plan recommended Postgres and an ORM. Both add setup friction before
the first page renders: a service to run, a connection string, a migration
pipeline. The product's risk is not in its persistence layer — it is in the
nutrition calculation, which must be testable in isolation.

**Decision**

| Layer | Choice |
|---|---|
| Runtime | Node 26 (ships `node:sqlite`) |
| Framework | Next.js 16, App Router, Turbopack |
| UI | React 19, Tailwind 4, hand-built components |
| Language | TypeScript, strict |
| Database | SQLite through `node:sqlite`, no ORM |
| Tests | Vitest, node environment |

**Consequences**

- A clean checkout runs with `npm install && npm run dev`. No Docker, no
  service, no keys.
- SQLite does not deploy to a serverless host. Migration is an S4 concern and
  is contained to `src/lib/db/`.
- No ORM means queries are hand-written SQL. With one table that is a benefit:
  the queries are the documentation.
- `node:sqlite` is server-only, so the repository layer must never be imported
  into a client component. This is enforced by `import type` at every client
  boundary.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Postgres + Drizzle now | Service and migration pipeline before the first page renders |
| Prisma | Codegen and a schema language for one table |
| `better-sqlite3` | Native build step for something Node now ships |
| In-memory store | Persistence is part of the walking skeleton; faking it hides the seam |

---

### D-028 — The product loop ships before AI

**Status:** Agreed
**Date:** 2026-11-14
**Relates to:** D-009, D-019

**Context**

D-019 says AI is required for the *designed* experience. That is a statement
about the product's ambition, not a build order. Building the estimation
pipeline first would mean building an enhancement for a loop that does not yet
exist, and would make every UI decision depend on an AI response.

**Decision**

Build in this order: food entry (S1) → recipes (S2) → planning (S3) → trust and
ship (S4) → AI estimation (P2). AI is designed for from the start — every
entity that AI will touch already has a place to record provenance and status —
but no AI feature blocks a slice.

**Consequences**

- The loop can be used and measured before estimation is built.
- The AI work inherits a working product instead of defining one.
- D-016's per-nutrient diff has a UI to land in, because recipe review exists
  first.
- Risk: the recipe model could be built in a way that makes adjustments
  awkward. Mitigated by D-015 and D-016 already fixing the ingredient-line shape.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| AI-first | Every screen becomes dependent on a model response before the calculation is proven |
| AI and loop in parallel | Two half-finished halves; nothing is usable |

---

### D-029 — A plan is a week of pinned entries

**Status:** Agreed
**Date:** 2026-11-14
**Relates to:** D-018, D-023, D-024

**Context**

S3 needs somewhere to put recipes. The product's unit of planning is a week,
not a day: people shop and cook in weeks. And D-024 already promises that a
saved plan does not change when a recipe or a food record changes.

**Decision**

A plan is one week starting Monday, with one implicit local plan per week. An
entry lives in a day and one of four slots, and is either a food with a stored
gram weight or a **pinned `recipe_version_id`** with a serving count — never
both. A `CHECK` constraint makes the invalid state impossible to store.

The week row is created on the first write, not on the first view, so browsing
empty weeks leaves nothing behind.

**Consequences**

- Editing a recipe creates a new version and leaves every planned week alone.
- The board scales the version's stored per-serving rollup; it never recomputes
  a recipe to draw a bar.
- The plan cannot trigger a food-data correction cascade, because there is no
  live link to correct.
- Accounts add a `user_id` to `plans`; they do not change the entry shape.
- Cost: a plan that wants the recipe's *new* numbers has to be re-planned
  explicitly. That is the intended meaning of a pin.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Live-link the recipe | Silently rewrites a week the user already planned |
| Copy the recipe's numbers into the entry | Duplicates a snapshot that the pinned version already carries |
| Plan per day | Shopping and cooking happen per week; per-day plans would be rebuilt from scratch |
| Create the plan row on page view | Leaves empty weeks behind and makes "no plan" indistinguishable from "empty plan" |

---

### D-030 — Targets are derived from the profile

**Status:** Agreed
**Date:** 2026-11-14
**Relates to:** D-025, Q-003

**Context**

Progress bars need a denominator. The alternative was a hardcoded adult target,
which would make the profile in the product spec decorative.

**Decision**

Store one local profile: sex, age, height, weight, activity and goal. Derive
targets on read with `targetsFor(profile)`:

- energy from Mifflin–St Jeor × activity, a goal delta, and a safety floor;
- protein from body weight and goal;
- fat, carbohydrate, fibre and sugars from energy;
- minerals and vitamins from ICMR–NIN 2020 reference values, banded by sex and
  age.

Targets are never persisted. The direction of each target comes from the
nutrient vocabulary, not from the target list.

**Consequences**

- Changing the profile moves the diary and the plan at once.
- There is no target history: a past week's bars can shift if the profile
  changes. Accepted for now, because targets are not part of the plan record.
- The reference micro values are unverified seed data. They are labelled as
  estimates in the UI and Q-003 stays open.
- A person whose needs the profile cannot express gets an override table later,
  not a column here.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Store 18 target rows per user | 18 rows to keep in sync for a value that is cheap to derive |
| Keep a fixed adult target | The product asks for a profile; it should use it |
| Ship a range per nutrient now | Q-003 is open, and a range changes the bar semantics |

---

## Superseded

None yet.

---

## How to add a decision

Write a record when the choice is **hard to reverse** or **expensive to
rediscover**. Not for reversible implementation details — those belong in a
commit message or a code comment.

1. Take the next ID. Never reuse or renumber.
2. Use the shape: Context → Decision → Consequences → Alternatives rejected.
3. The alternatives section is the most valuable one. A record without it will
   be re-argued.
4. Add a row to the relevant table above.
5. If it reverses an earlier record, mark that one `Superseded by D-0NN` and
   link both ways.
