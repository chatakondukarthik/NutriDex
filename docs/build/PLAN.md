# NutriPlan — Build Plan

**Status:** Active
**Rule:** no slice starts before the previous one is live. A skeleton proves the
pipeline; breadth comes later.

---

## The slices

| Slice | Appetite | Proves | State |
|---|---|---|---|
| S0 — Skeleton | 2–3 days | The pipeline exists end to end | Done |
| S1 — Food | 1 week | The calculation engine | Done (seed data) |
| S2 — Recipe | 1.5–2 weeks | The block model and versioning | Done |
| S3 — Plan | 1 week | The loop closes | Done |
| S3.5 — Theme and transparency | 2–3 days | The product feels designed, and its numbers can be checked | Done |
| S4 — Trust and ship | 1 week | Someone can use it unaided | In progress |

---

## S0 — Skeleton

Repo, CI, deploy, database, one page that reads from it.

**Done when:** a commit is live on a public URL without manual steps.

---

## S1 — Food

Search seeded foods; add one with a portion; see nutrition per 100 g and per
portion, with coverage.

**Done when:**

- [x] `resolve(food, portion) → grams` is a tested pure function.
- [x] A wrong portion unit cannot silently produce a wrong number.
- [x] A food with a missing nutrient displays `unknown`, not `0`.
- [x] Energy sanity check runs over every seed food.
- [x] Persistence round-trips an entry.

**Not included:** recipes, plans, targets editing, AI.

**Known gap:** the 20 foods are fixtures, not the verified dataset. The importer
is the first task of S1.5.

---

## S2 — Recipe

Create a recipe with two blocks; add ingredient lines; set an operation and an
optional measured output mass; write instructions; set servings; see per-block
subtotals, the recipe total and per-serving values; save it as a version.

**Done when:**

- [x] Each block rolls up independently and shows its own subtotal (F30).
- [x] A measured output mass changes per-100 g but not the total (F29).
- [x] Saving, editing, saving again produces two versions; the first is unchanged.
- [x] A single-block recipe is indistinguishable in the UI from a flat list.

**Known limits:**

- The client preview recomputes every block on each keystroke. The *values* are
  block-independent, but there is no incremental cache yet; a recipe with many
  blocks will feel it before the user does.
- A recipe's cooked mass is the final block's measured output. Weighing only an
  intermediate block gives `yieldBasis = partial` and no per-100 g figure.

**Not included:** component reuse, variants, AI adjustments.

**Shipped:** five-section builder (`/recipes/new`, `/recipes/[id]/edit`),
preset templates, immutable versions with a stored nutrition snapshot, per-block
subtotals, coverage-aware nutrient rows, version history.

---

## S3 — Plan

A 7-day grid with four slots per day; drag a recipe or food into a slot; remove
it; progress bars fill live on drop; targets come from the profile.

**Done when:**

- [x] Dropping an item updates the bar within one interaction, no reload.
- [x] Removing it restores the bar exactly.
- [x] A day with no entries shows an honest empty state, not zero-filled bars.
- [x] Targets come from a profile, not a hardcoded constant.

**Known limits:**

- A planned food is entered in grams. The schema stores an amount and unit, but
  the board does not yet offer a portion picker there.
- The board holds entries in client state after the first paint. It is
  optimistic and survives navigation, but two open tabs can disagree until one
  reloads.
- There is one implicit local profile and one plan per week. Accounts arrive in
  S4 and add a `user_id`; they do not change the shape.
- The profile's mineral and vitamin targets are unverified ICMR–NIN 2020 seed
  values (Q-003).
- Actual consumption is not logged; the plan is a plan, not a diary.

**Not included:** copying a day or a week, shopping lists, planned vs actual.

**Shipped:** a Monday-based week (`/plan?week=YYYY-MM-DD`), a palette of recipes
and foods, tap-to-add and drag-to-add, inline quantity edits, optimistic
day totals, per-day energy bars, a selected-day 18-nutrient panel, and a
`/profile` form whose derived targets drive both the plan and the diary.

Since the slice closed, the board also supports moving a placed item by its grip
handle, Alt-drop to copy, a copy-to-palette button that keeps the quantity, a
version selector per recipe, and a Day/Week nutrition panel grouped by guidance
role (D-032).

---

## S3.5 — Theme and transparency

The loop worked; it did not yet look or explain itself like a product.

**Done when:**

- [x] Every colour, radius and duration is a semantic token, not a literal.
- [x] Light, dark and system modes; four accents; a motion switch. Persisted in
      cookies and applied before paint.
- [x] Route-level skeletons with a shimmer, so a slow read never shows a blank.
- [x] The profile page shows the BMR equation, the activity multiplier, the pace
      rate and every safety rail, and the numbers change live as fields change.
- [x] The plan can be read as a day or as a week, and says which nutrients are
      judged in which window.

**Not included:** user-authored themes, per-page accents, a design-system
document. The token layer is the extension point.

---

## S4 — Trust and ship

Empty, loading and error states; coverage indicators; attribution page; health
disclaimer; mobile pass.

**Done when:** someone who has never seen the app plans a day without asking a
question.

**Progress:**

- [x] Route-level loading skeletons (S3.5).
- [x] A root error boundary with a retry and a digest, and a 404 page that
      offers the diary and the plan.
- [x] An attribution page (`/about`): the energy equation, the rails, the
      day-versus-week rules, the data sources, what is stored, and a health
      disclaimer. Linked from the header.
- [x] Coverage indicators on every nutrient (known / estimated with `n/m` /
      unknown), and the same status legend explained in words on `/about`.
- [x] Mobile pass on the plan board: one day at a time behind a picker, instead
      of seven unreadable columns.
- [x] Mobile pass on the header and the diary: the nav takes its own row below
      `sm` instead of scrolling "About" out of reach, icon buttons keep a 36 px
      target, the diary grid can shrink, and row actions are visible without
      hover. Every route fits 320 px with no horizontal overflow.
- [ ] First-run guidance for an empty profile and an empty week.
- [ ] A keyboard-only pass and an empty-state audit across all routes.

---

## Definition of done for v1

Not "all features shipped". These five statements:

1. A real person plans a real week of their own food, unaided.
2. Every number shown traces to a source or is marked `estimated`.
3. Missing data is visibly missing, never silently zero.
4. A saved plan does not change when a food record is corrected.
5. Nothing claims more precision than the data supports.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Portion conversion is wrong, so everything downstream is wrong | High | Done in S1, before recipes |
| The 18-nutrient set is too narrow to fill the bars | Medium | Bars show coverage; expanding the vocabulary is a data change |
| Block model makes simple recipes feel heavy | Medium | Single block is the default path |
| Drag-and-drop is fiddly on touch | Medium | Ship tap-to-add first, drag second |
| Indian packaged-food data does not exist | High | OCR from the label is the primary path, not a lookup |
| Scope grows during a slice | High | The scope matrix; anything new goes to *Next* |
