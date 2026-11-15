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
| D-031 | Pace is a body-weight rate, and the energy rails are visible | Agreed | [below](#d-031--pace-is-a-body-weight-rate-and-the-rails-are-visible) |
| D-032 | A day and a week are different judgement windows | Agreed | [below](#d-032--a-day-and-a-week-are-different-judgement-windows) |

### Capture and AI

| ID | Decision | Status | Full record |
|---|---|---|---|
| D-033 | One capture pipeline; ingredient, recipe and sub-ingredient are destinations, not flows | Proposed | [below](#d-033--one-capture-pipeline-three-destinations) |
| D-034 | The model proposes, the engine disposes; no model-supplied value for an unknown nutrient | Proposed | [below](#d-034--the-model-proposes-the-engine-disposes) |
| D-035 | The server is the only client of a provider; keys are never in the browser, the database or a log | Proposed | [below](#d-035--the-server-is-the-only-client-of-a-provider) |
| D-036 | A provider is an adapter; the model list comes from the provider, not from code | Proposed | [below](#d-036--a-provider-is-an-adapter) |
| D-037 | The prompt is a versioned contract: a JSON schema, temperature 0, no nutrient data sent | Proposed | [below](#d-037--the-prompt-is-a-versioned-contract) |
| D-038 | Model quality is judged by a golden-set harness with an error budget, not by unit tests | Proposed | [below](#d-038--model-quality-is-judged-by-a-harness) |
| D-039 | Status is never conveyed by colour alone; yellow/red overflow carries words and an icon | Proposed | [below](#d-039--status-is-never-conveyed-by-colour-alone) |

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

### D-031 — Pace is a body-weight rate, and the rails are visible

**Status:** Agreed
**Date:** 2026-11-15
**Relates to:** D-030, Q-003

**Context**

The first energy target applied a fixed delta (−400 / 0 / +300 kcal). That
number means something different to a 55 kg person and a 120 kg person, so the
same "lose weight" choice produced a gentle deficit for one and an aggressive one
for the other. It also made the pace impossible to explain: the user chose
"lose", not "lose 400 kcal".

**Decision**

Store the pace as an enum (`gentle`, `steady`, `fast`) and derive the rate as a
share of current body weight per week:

| Goal | Gentle | Steady | Fast |
|---|---|---|---|
| Lose | 0.25 % | 0.5 % | 0.75 % |
| Gain | 0.125 % | 0.25 % | 0.5 % |

Convert the rate to a daily adjustment at 7,700 kcal/kg. Apply three rails:

- never below 1,200 kcal (female) / 1,500 kcal (male);
- never a deficit above 25 % of maintenance;
- never a surplus above 15 % of maintenance.

Report the **effective** rate — what the applied adjustment actually implies —
and use it for the target-weight projection. When a rail bites, say so next to
the number.

Body fat percentage is an optional field. When present, BMR switches from
Mifflin–St Jeor to Katch–McArdle, because lean mass is the better predictor.
Target weight is optional and only feeds a projection; it never changes a target.

**Consequences**

- The rate follows the current weight, so it does not go stale as the user loses
  or gains.
- A capped pace shows a smaller kg/week than the option promises. That is the
  honest number, and the UI discloses the cap rather than silently rounding.
- The profile form grows three optional fields. Two are nullable and one has a
  default, so the additive migration applies without a rewrite.
- The rails are product policy, not clinical advice. They are labelled as guard
  rails and do not replace medical guidance.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Keep a fixed kcal delta | The same choice means different things at different body weights |
| Store kg/week directly | It goes stale the moment the weight changes |
| Drop the rails and let the user choose any deficit | A 40 % deficit is reachable by tapping "fast" and is not a safe default |
| Show the requested rate even when capped | It promises a rate the target cannot deliver |

---

### D-032 — A day and a week are different judgement windows

**Status:** Agreed
**Date:** 2026-11-15
**Relates to:** D-025, D-030

**Context**

Every nutrient had one daily target and every bar was judged against it. That
made a low-fibre afternoon look like a failure and a single high-sodium meal look
like a breach, when both are averages over time. It also made the day panel
unreadable: eighteen bars, most of them short at 6 p.m., with no way to tell a
real gap from a normal one.

**Decision**

Give every target a `role`:

- `daily-anchor` — energy and protein. Judged per day; they should land on most
  days, not just in total.
- `weekly-minimum` — carbohydrate, fibre, potassium, calcium, iron, zinc,
  magnesium, and the vitamins. Judged over the week.
- `weekly-limit` — fat, total sugars, sodium. Judged over the week.

`assessDay()` judges only the anchors. `assessWeek()` judges all three groups.
The plan panel offers Day and Week; the diary judges the anchors and the crossed
ceilings and says in words that the rest are weekly.

A bar's colour follows its status, not its fill percentage: accent for `met`,
amber for `low`/`high`, grey for `neutral` (the wrong window, or nothing to
judge), and no bar for `unknown`.

**Consequences**

- A day can no longer report "3 of 8 vitamins met". That statement was never
  true; it invented a failure the model does not have.
- The week view needs a weekly reference, which is seven daily references. That
  is correct for an average and wrong for a hard ceiling over seven days — the
  wording says "across the week" rather than "daily × 7" for that reason.
- The plan and the diary now group nutrients by guidance role rather than by
  macro/mineral/vitamin. The diary keeps the nutrient groups because it is
  browsing a single day's data, not judging it.
- Adding a nutrient means choosing a role. There is no default that is right for
  every nutrient, so the vocabulary table must be edited deliberately.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Judge everything daily | A normal day looks like a failure on most micronutrients |
| Judge everything weekly | Energy and protein need daily attention; a weekly total hides a starving Tuesday |
| Colour by percentage only | 90 % of a ceiling and 90 % of a minimum mean opposite things |
| Hide weekly nutrients on the day view | The user still needs to see the data, just not be judged by it |

---

### D-033 — One capture pipeline, three destinations

**Status:** Proposed
**Date:** 2026-11-15
**Relates to:** D-011, D-012, D-013, D-023

**Context**

The user wants to "scan and add something as ingredients or add that as recipe
or sub ingredient". Read as three features, that is three wizards, three review
screens and three places where a wrong gram weight can enter. Read as one
capture with three destinations, it is one pipeline.

**Decision**

Every entry method — search, barcode, label photo, text, manual — produces a
`CaptureInput`, passes through one pure `resolve`, and lands on one review
screen. The review screen then chooses a destination:

- a diary or plan entry,
- an ingredient line in the open recipe block,
- a new recipe promoted from the capture,
- a component pinned into the open block,
- the library, or both placing and saving.

There is no separate "sub-ingredient" entity. A sub-ingredient is a recipe with
`kind = 'component'` (D-023), so pinning, archive-not-delete and
update-available all apply unchanged.

**Consequences**

- One `resolve` to test, one review component to make accessible, one place to
  fix a conversion bug.
- The builder, the diary and the plan board all gain capture from the same work.
- A destination can be added without touching capture, and vice versa.
- The capture UI must always answer "where does this go?" even when there is
  only one obvious answer, or the user cannot tell what just happened.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Three wizards (ingredient / recipe / sub-ingredient) | Three copies of review, validation and provenance; the boundary is the user's intent, not the data |
| Reuse the recipe builder for everything | A one-off food would have to become a recipe, violating D-013 |
| A separate sub-ingredient table | A second model to version, pin and archive; D-013's one-model rule exists to prevent this |

---

### D-034 — The model proposes, the engine disposes

**Status:** Proposed
**Date:** 2026-11-15
**Relates to:** D-009, D-016, D-025

**Context**

A capture model will be asked for nutrient values. If its numbers are stored,
the product's central promise — every value traces to a source or is marked
estimated — is broken by the fastest path in the app.

**Decision**

A model response is data, never a result.

- It returns names and candidate values. It never returns a food id, and
  `resolve` matches names against the food list; a non-match becomes a
  provisional food.
- Every quantity goes through `toGrams`.
- If the matched food does not know a nutrient, a model-supplied value for that
  nutrient is **discarded** and the nutrient stays `unknown`.
- Any value that is kept is stored `estimated` with the model and prompt version
  in its provenance, and appears as a per-nutrient diff (D-016).
- Model-reported confidence is recorded in the audit trail and used for
  nothing else.

**Consequences**

- A hallucinated number cannot become a stored value.
- The worst a model can do is propose the wrong *food*, which review catches.
- Capture is slower to build than a naive passthrough, because every field needs
  a rule for "the model said it but we do not know it".
- `resolve` becomes the highest-value pure function in the product and gets the
  most tests.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Store model values as `estimated` | Still stores a number with no source; "estimated" would stop meaning anything |
| Let the model pick a food id | It cannot know our ids; a confident wrong id is the worst failure mode |
| Use model confidence to decide | D-016 already rejects self-reported confidence |
| Skip review when confidence is high | Review is what makes the estimate defensible |

---

### D-035 — The server is the only client of a provider

**Status:** Proposed
**Date:** 2026-11-15
**Relates to:** D-019

**Context**

NutriPlan is a web app. Calling Gemini, OpenAI or Anthropic from the browser
means shipping the API key to the client, where any user can read it. Fud AI
can call providers directly only because it is a native app with a keychain.

**Decision**

Every provider call is made by Next server code. The browser sends
`{ provider, model, capability, payload }` to a server action; the server adds
the key, makes the call, and returns a proposal.

Keys live in environment variables or in `data/secrets.json` (mode `0600`,
gitignored). They are never in SQLite, a cookie, localStorage, a client bundle,
a log line or an error message. If both an env var and a file value exist for
the same provider, that is an error rather than a silent precedence.

**Consequences**

- The key cannot leak through the front end.
- A capture costs a round trip to our server, so a call needs a timeout, a
  pending state and a retry story.
- Self-hosting requires the operator to set a secret; there is no default key.
- The settings UI can only report "configured", never the value.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Call the provider from the browser | Ships the secret to every client |
| Proxy through a third-party BYOK service | Adds a dependency and a party that sees user data |
| Store keys in SQLite | A database export or backup leaks them; backups are the common leak |
| Hardcode a NutriPlan key | Not viable at any scale, and it makes us the provider |

---

### D-036 — A provider is an adapter

**Status:** Proposed
**Date:** 2026-11-15
**Relates to:** D-019

**Context**

The user should be able to choose Google, OpenAI, Anthropic or any
OpenAI-compatible endpoint and pick a model. Hardcoding a provider list or a
model list means every new model is a code change, and hardcoded model names rot
within months.

**Decision**

One interface — `complete`, `listModels` — with an adapter per API style:
Gemini, OpenAI, Anthropic, OpenAI-compatible. The model list is fetched from the
provider and cached; a refresh action and a bundled fallback list cover an
unreachable provider. Adding a provider is a new adapter file and a row, never a
change to the capture flow.

**Consequences**

- Providers that share an API style (Groq, Together, OpenRouter, Mistral,
  Ollama, DeepInfra, Fireworks, Cerebras, Qwen, DeepSeek) are configuration, not
  code.
- A wrong model name fails as "unknown model", not as a silent fallback.
- Capability filtering (vision, JSON schema) is derived from the adapter, so the
  settings UI cannot offer a model that cannot do the job.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Hardcode models per provider | Model names change faster than our release cadence |
| One generic OpenAI-compatible adapter only | Gemini and Anthropic have real differences in schema and vision handling |
| Let the user type any model name | A typo becomes a confusing provider error instead of a clear "not a model we know" |

---

### D-037 — The prompt is a versioned contract

**Status:** Proposed
**Date:** 2026-11-15
**Relates to:** D-034, D-036

**Context**

Prompts drift. A model answer that was parseable last month can change shape
without warning, and a capture bug would look like a food bug.

**Decision**

Every call sends a JSON schema from the repo and asks for JSON, at temperature 0
for extraction. The schema is versioned with the code and tested against a fake
adapter. A prompt contains the task, the schema, food **names and aliases only**,
and the user's text or OCR text — never our nutrient data.

**Consequences**

- A provider upgrade that changes output shape breaks a test, not a user.
- We never send our database to a provider.
- Prompt changes are reviewable in the same diff as the code that depends on
  them.
- Repair is allowed once (repeat the schema), then the call fails.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Free-text prompt, parse what comes back | Shape is unstable; a food silently loses a nutrient |
| Send the whole food record | Leaks our data and invites the model to echo it back as an answer |
| Temperature above 0 for "better" answers | Extraction should be deterministic; variety is not a feature here |

---

### D-038 — Model quality is judged by a harness

**Status:** Proposed
**Date:** 2026-11-15
**Relates to:** D-034, D-037

**Context**

Unit tests prove the parser and the resolver. They cannot prove the model read a
label correctly, and "the AI works" is otherwise an article of faith.

**Decision**

A golden set of inputs with expected structured output, a runner, and a score.
The deterministic half (parse, validate, resolve) is unit-tested with a fake
adapter replaying recorded responses; the live half is an opt-in script against
a real provider. A release candidate may not regress below an agreed error
budget.

**Consequences**

- Model and prompt changes are measurable.
- A provider switch is a comparison, not a hope.
- The error budget is set from a baseline run, so it is a real number.
- Someone has to maintain the golden set; it is a product artefact, not a test
  fixture.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Unit tests with a fake model | Proves plumbing, not quality |
| Manual spot checks | Not repeatable; regressions ship silently |
| Trust the provider's benchmark | Their benchmark is not our labels |

---

### D-039 — Status is never conveyed by colour alone

**Status:** Proposed
**Date:** 2026-11-15
**Relates to:** D-032

**Context**

The user asked for overflow states that change colour — yellow when a tracked
nutrient is approaching or past its target, red when it is clearly over. Colour
is the right channel for a quick read, but it is the only channel that
colour-blind users and screen-reader users do not have.

**Decision**

Every status has three channels: colour, a word, and an icon or symbol where the
status is not otherwise labelled. A bar that is amber says "over" or "under"
beside it; a red day total says "over target"; a captured value that needs
review says so in words.

**Consequences**

- The yellow/red overflow work is accessible by construction, not by a later
  fix.
- The day/week status colours (D-032) get the same treatment in the same pass.
- Slightly more text in the UI, which is the cost of not excluding users.

**Alternatives rejected**

| Alternative | Why it lost |
|---|---|
| Colour only, with a legend | A legend is not on the element; colour-blind users still cannot read it |
| Icon only | An icon is ambiguous without a shared vocabulary |
| Text only | Loses the at-a-glance read that makes the bars useful |

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
