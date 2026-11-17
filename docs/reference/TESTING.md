# NutriPlan — Testing

**Type:** Reference (updated in the same commit as the code it describes)
**Last verified:** 2026-11-17 — 52 files, 587 tests passing, `tsc --noEmit` clean.

This is the tracker for how NutriPlan is tested: what is automated, what is
manual, what each category is for, and what is still missing. It is a map, not
a claim — a case marked `Pass` means a test asserts it today, not that the
behaviour was audited by hand.

---

## Running it

```bash
npm test          # both projects
npm run typecheck # separate; the test suite does not type-check
npm run build     # production build; stop `next dev` first, they share .next
```

Vitest runs two projects (`vitest.config.ts`):

| Project | Environment | Include | What it proves |
|---|---|---|---|
| `unit` | node | `tests/**/*.test.ts` | Pure logic, repositories, server actions |
| `component` | jsdom | `tests/components/**/*.test.tsx` | Interaction, keyboard, ARIA, accessibility |

Never put a DOM test in the `unit` project or a `node:sqlite` test in
`component`. The split is what makes the suite fast enough to run on every
change.

---

## Categories

A category is not a test framework, it is a question. One test can serve two
categories; the ID says which question it answers.

| ID prefix | Category | Question it answers | Primary home |
|---|---|---|---|
| `U-` | Unit | Is the calculation correct? | `tests/*.test.ts` |
| `C-` | Component | Does the control behave as a user expects? | `tests/components/*.test.tsx` |
| `I-` | Integration | Does a request survive the server-action boundary? | `tests/actions.test.ts` |
| `A-` | Accessibility | Can a keyboard or screen-reader user do this? | `tests/components/accessibility.test.tsx` |
| `D-` | Data integrity | Can the database end up in a state the UI cannot read? | `tests/data-integrity.test.ts` |
| `P-` | Performance | Does this stay linear as the data grows? | `tests/perf.test.ts` |
| `S-` | Security and privacy | Can untrusted input cause damage or leak? | split — see below |
| `R-` | Responsive | Does it fit and stay usable at 320 px and up? | manual, recorded below |
| `E-` | End-to-end | Does a whole user journey work in a real browser? | **not automated yet** |

---

## Automated cases

Status values: `Pass` (asserted in CI), `Gap` (known, not asserted), `Plan`
(designed, not written).

### U — Unit

| ID | Area | Representative cases | Status |
|---|---|---|---|
| U-001 | Nutrient profiles | Omitted nutrient is `unknown`, never 0; provenance survives; scaling preserves coverage; non-positive servings rejected | Pass (8) |
| U-002 | Rollup | Sums by mass; partial coverage reported; unknown never suppresses known; empty rollup is unknown not zero | Pass (5) |
| U-003 | Energy sanity | Atwater energy; fibre at 2 kcal/g and removed from carbohydrate; every seed food within gross-error tolerance | Pass (3) |
| U-004 | Units | g, kg, ml density, missing density disclosed, named portions, unknown portion fails, non-positive fails, **overflow fails** | Pass (10) |
| U-005 | Completeness | Fraction of tracked nutrients known | Pass (1) |
| U-006 | Search | Indian alias, exact-name ranking, empty query | Pass (3) |
| U-007 | Recipe blocks | Block rollup, measured output changes per-100 g not total, operation is inert without yield, partial yield | Pass (12) |
| U-008 | Recipe draft | Builder→draft conversion, incomplete rows dropped, server-accepted draft, preview matches server, blank servings is missing | Pass (10) |
| U-009 | Recipe round trip | Stored version rebuilds an equivalent builder, named portion and preparation preserved | Pass (2) |
| U-010 | Profile | Mifflin default, Katch–McArdle with body fat, PAL, pace rate, rails, floor, effective rate, projection | Pass (42) |
| U-011 | Targets | Reference values per role, `periodTarget`, `assessDay` judges anchors only, `assessWeek` judges all | Pass (11) |
| U-012 | Plan calendar | Monday start, month/year rollover, seven consecutive days, slot set, ordering | Pass (6) |
| U-013 | Plan rollup | Food scaled by grams; pinned recipe from snapshot; gone target returns null; empty day unknown; food+recipe combined | Pass (7) |
| U-014 | Recipe validation | Name, servings, empty blocks, unknown food, bad unit, bad amount, named portions, block naming, non-positive output, snapshot, overflow | Pass (19) |
| U-015 | Captured food validation | Empty name, omitted nutrients unknown, estimated marking, energy ceiling, portion weight, portion count, alias dedup | Pass (7) |
| U-016 | AI extraction parsing | Clean JSON, code fences, truncated repair, no-JSON throw, unknown codes ignored, proposal→input | Pass (6) |

### C — Component (recipe builder)

| ID | Case | Status |
|---|---|---|
| C-001 | One empty row starts with an enabled remove button | Pass |
| C-002 | Add then remove an ingredient row | Pass |
| C-003 | Removing the last ingredient clears the row instead of deleting it | Pass |
| C-004 | Picker opens; outside pointer press closes it | Pass |
| C-005 | Escape closes and returns focus to the trigger | Pass |
| C-006 | Choosing a food closes the picker and shows the selection | Pass |
| C-007 | Opening one picker closes the other | Pass |
| C-008 | Arrow keys + Enter select from the list | Pass |
| C-009 | Empty search says so | Pass |
| C-010 | Step navigation forward and back | Pass |
| C-011 | Save stays disabled until name, ingredient and servings are valid | Pass |
| C-012 | Successful save sends the draft and navigates | Pass |
| C-013 | Server error is shown and no navigation happens | Pass |

### I — Integration (server actions against a throwaway SQLite file)

| ID | Case | Status |
|---|---|---|
| I-001 | `addFoodAction` stores converted grams, not the raw amount | Pass |
| I-002 | `addFoodAction` rejects 7 hostile shapes and writes nothing | Pass |
| I-003 | `removeEntryAction` removes only the requested row | Pass |
| I-004 | Plan add: food, and pinned recipe scaled by servings | Pass (2) |
| I-005 | Plan add: 12 rejections — week, day-in-week, impossible date, slot, both/neither, unknown food, bad grams, oversized grams, unknown version | Pass |
| I-006 | A rejected plan add creates no empty plan row | Pass |
| I-007 | Move within the week; refuse a move outside it | Pass |
| I-008 | Quantity update rejects non-positive and oversized | Pass |
| I-009 | Captured food round trip, archival blocking, duplicate name | Pass (4) |
| I-010 | Day/week copies are transactional; a week input is normalised to its Monday | Pass (3) |
| I-011 | `saveGraphAction` rejects oversized or invalid graphs, layout and metadata | Pass (7) |
| I-012 | `importInndbAction` rejects a malformed mapping and imports a valid one | Pass (4) |
| I-013 | Plan servings, recipe block/input and captured-food input caps | Pass (5) |

### A — Accessibility

| ID | Case | Status |
|---|---|---|
| A-001 | Builder, ingredient step — no axe structural violations | Pass |
| A-002 | Builder, picker open — combobox/listbox/option names and relationships | Pass |
| A-003 | Builder, after a food is chosen | Pass |
| A-004 | Builder, review step | Pass |

Colour-contrast and `region` rules are disabled in jsdom (no layout, no app
shell). Contrast is covered by the token review in R-003, not by axe.

### D — Data integrity

| ID | Case | Status |
|---|---|---|
| D-001 | `foreign_keys`, `busy_timeout = 5000`, `journal_mode = wal` | Pass |
| D-002 | Every column the code reads exists | Pass |
| D-003 | Migration is idempotent on an existing file | Pass |
| D-004 | Plan entry cannot be both food and recipe | Pass |
| D-005 | Plan entry cannot be neither | Pass |
| D-006 | Plan entry can be exactly one | Pass |
| D-007 | No plan entry can point at a missing recipe version | Pass |
| D-008 | A recipe version in use cannot be deleted | Pass |
| D-009 | No component input can outlive its component | Pass |
| D-010 | `(recipe_id, version_no)` is unique | Pass |
| D-011 | A failed transaction writes nothing | Pass |
| D-012 | A successful transaction commits | Pass |
| D-013 | An interrupted `entries` rebuild is finished on boot; an ambiguous both-tables state refuses to start | Pass |
| D-014 | `BEGIN IMMEDIATE` takes the write lock; an async callback is rejected; the original error survives a rollback | Pass |
| D-015 | Export contains every user table, referenced evidence and a manifest with a checksum per entry | Pass |
| D-016 | Export → wipe → import restores identical content, compared by a per-table hash | Pass |
| D-017 | A stored recipe snapshot survives the round trip byte-for-byte | Pass |
| D-018 | Merge adds missing rows, keeps existing ones, and reports a differing row as a conflict instead of overwriting it | Pass |
| D-019 | A dry run changes nothing; a table with zero rows imports without a malformed `INSERT` | Pass |
| D-020 | Evidence images are restored with their original bytes | Pass |

### P — Performance

| ID | Case | Status |
|---|---|---|
| P-001 | 7 × 200-ingredient rollup under 500 ms | Pass |
| P-002 | 10× the work costs under ~40× the time (quadratic guard) | Pass |
| P-003 | 500 day+week assessments under 500 ms | Pass |

Budgets are ~100× a warm local run so they stay green on a loaded machine and
still catch a real regression. They are guards, not benchmarks.

### S — Security and privacy

| ID | Case | Where | Status |
|---|---|---|---|
| S-001 | Server actions treat input as untrusted and validate before writing | `tests/actions.test.ts` | Pass |
| S-002 | Gram conversion happens on the server; the client's number is never stored | `tests/actions.test.ts` I-001 | Pass |
| S-003 | An unknown food id cannot reach the database | U-014, I-005 | Pass |
| S-004 | Overflow and absurd quantities are rejected | U-004, U-014, I-005 | Pass |
| S-005 | No secrets in the client bundle | — | Gap (no bundle assertion) |
| S-006 | LLM provider keys are server-only and `0600`; not encrypted (OS volume) | `tests/ai-secrets.test.ts`, `tests/private-files.test.ts` | Pass |
| S-007 | Provider base URLs are SSRF-safe; mapped/NAT64 literals are rejected | `tests/security-urls.test.ts` | Pass |
| S-008 | Image uploads are size-, type- and count-limited | `tests/actions.test.ts` | Pass |
| S-009 | Request gate and cross-site mutation checks | `tests/security-gate.test.ts`, `tests/security-origin.test.ts` | Pass |
| S-010 | Keys are bound to the host they were entered for; env keys are host-pinned | `tests/ai-secrets.test.ts` | Pass |
| S-011 | Data directory and files are `0700`/`0600`; atomic writes survive faults | `tests/private-files.test.ts`, `tests/private-files-faults.test.ts` | Pass |
| S-012 | Graph, recipe, captured-food and import-mapping shapes are bounded | `tests/graph-validate.test.ts`, `tests/actions.test.ts`, `tests/csv.test.ts` | Pass |
| S-013 | Migrations and transactions recover from an interrupted write | `tests/db-recovery.test.ts` | Pass |
| S-014 | An imported archive is hostile input: tampered checksums, unlisted files, duplicate manifest paths, local/central header mismatches, unknown tables, traversal names, zip bombs, missing required columns, dangling parents, planted `origin`, refused settings and unsafe image paths are all refused or dropped | `tests/archive.test.ts` | Pass |
| S-015 | An upload with no trustworthy `content-length` is abandoned at the byte ceiling, not buffered | `tests/http-body.test.ts` | Pass |

S-005 remains a gap: there is no build-time assertion that a key cannot be
imported into a client component. Today keys are read only by server modules
(`src/lib/ai/secrets.ts`, `src/lib/ai/config.ts`).

---

## Manual cases

Automated tests cannot see layout, colour, motion or a real camera. These are
run by hand and the result recorded here with the date.

| ID | Case | How | Last result |
|---|---|---|---|
| R-001 | 320 px, 390 px, 768 px, 1024 px, 1440 px: no horizontal overflow | Same-origin iframe in the browser, or a device toolbar | Pass 2026-11-15 (320/390 desktop week) |
| R-002 | Mobile header: all five nav links reachable below `sm` | 390 px viewport | Pass 2026-11-15 |
| R-003 | Contrast: every text/background pair ≥ 4.5:1 in light **and** dark | Token review, both themes | Pass 2026-11-15 (token audit) |
| R-004 | Reduced motion: animations off, nothing essential moves | `data-motion="reduced"` toggle | Pass 2026-11-15 |
| R-005 | Keyboard-only pass across diary, plan, recipes, profile | Tab/Shift+Tab/Enter/Escape, no mouse | Partial — builder done 2026-11-15; plan board and profile outstanding |
| R-006 | Empty states read as an invitation on every route | Visual pass | Partial — outstanding |
| R-007 | Real camera capture and label OCR on a phone | Device, not simulator | Not run (S6) |
| R-008 | Drag a recipe card: the preview is a rounded card, not a rectangle | Visual pass | Pass 2026-11-15 |
| R-009 | Placed plan items are copyable and movable | Browser | Pass 2026-11-15 |
| R-010 | Skeleton shimmer before content on a slow read | Throttled network | Pass 2026-11-15 |
| R-011 | Restore an archive on a second machine with no account | Download on machine A, copy the ZIP, import on machine B, compare counts | Not run |

---

## End-to-end

**Status: planned, not built.** E2E would run Playwright against a real server
and a throwaway database, and would own:

- E-001 diary → add food → totals update → reload persists
- E-002 build a recipe → save → appears in the palette → place on the plan
- E-003 plan → move/copy an entry → day totals change
- E-004 profile → change pace → targets change → bars re-judge
- E-005 theme → switch accent and mode → survives reload

Rationale for deferring: the component and action layers already cover the
behaviour; what E2E adds is wiring and rendering under a real network. It
should be added when a journey is about to be reshaped, not before. See
`docs/build/PLAN.md` S5.

---

## What is deliberately not tested

- **Visual design quality.** Axe finds structural problems; it cannot find a
  page that looks templated. That is a review, recorded in R-006.
- **Model output quality.** LLM answers are non-deterministic; they get an
  evaluation harness with golden cases and an error budget, not unit tests.
- **Real food database correctness.** The 20 seed foods are fixtures. Provenance
  is tested; the numbers are not verified until an importer runs.

---

## Adding a case

1. Pick the smallest category that can fail.
2. Give it an ID and add it to the table in the same commit as the test.
3. If it is a regression, the test must fail on the old code. If it does not,
   it is not a regression test.
4. Manual cases get a date. An undated `Pass` is a `Gap`.
