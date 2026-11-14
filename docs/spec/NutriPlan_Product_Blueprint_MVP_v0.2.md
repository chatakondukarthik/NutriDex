# NutriPlan --- Product Blueprint and MVP Plan

**Document status:** Working baseline / subject to revision\
**Version:** 0.1\
**Date:** 10 November 2026\
**Product type:** Personal, planning-first nutrition web application\
**Working name:** NutriPlan (placeholder)

> This document is the current reference plan, not a frozen
> specification. Requirements, priorities, data sources and technical
> choices can change as the product is explored and built. Record
> material changes in the decision log.

------------------------------------------------------------------------

# 1. Product vision

NutriPlan helps a person design daily and weekly meal plans, calculate
the nutritional contribution of each ingredient and recipe, evaluate the
plan against configurable nutritional targets, identify potential gaps
or excessive intake, and compare planned meals with what was actually
eaten.

The product is **planning-first**, not another calorie diary. Fud AI
remains the user's primary food-logging application initially. NutriPlan
owns planning, recipes, targets, nutrition analysis and a separate
actual-consumption model. Future integration should use supported
health-data or export interfaces rather than depend on undocumented
APIs.

## 1.1 Core questions

1.  What should I eat?
2.  How much should I eat?
3.  Will the plan meet my configured nutrition targets?
4.  Which nutrients are below target, above a limit, or unknown because
    food data is missing?
5.  What can I change while keeping other constraints reasonably stable?
6.  How did actual intake differ from the plan?

## 1.2 Product boundaries

  -----------------------------------------------------------------------
  Capability                          Scope
  ----------------------------------- -----------------------------------
  Daily and weekly meal planning      Core

  Food and ingredient database        Core

  Recipes and serving calculations    Core

  Nutrition calculation engine        Core

  Configurable nutrient targets       Core

  Planned nutrition analysis          Core

  Basic planned-vs-actual records     MVP

  AI meal analysis and suggestions    Later phase

  Fud AI / Health Connect integration Future, subject to supported
                                      interfaces

  Exercise tracking                   Out of initial scope

  Medical diagnosis or treatment      Explicitly out of scope
  -----------------------------------------------------------------------

## 1.3 Initial user journey

1.  Configure a nutrition profile and preferences.
2.  Set or review nutritional targets.
3.  Search for foods and create recipes.
4.  Build a daily or weekly meal plan.
5.  Inspect calories, macros and all available micronutrient data.
6.  Adjust ingredients and quantities to improve the plan.
7.  Record actual consumption manually at first.
8.  Compare planned and actual intake.

------------------------------------------------------------------------

# 2. Product requirements

## 2.1 Personal nutrition profile

**MVP requirements** - Personal details relevant to nutrition reference
selection: age, sex where relevant to the reference standard, height,
weight and activity context. - Goal type: fat loss, maintenance or
muscle gain (user-configured; not a medical prescription). - Dietary
pattern and food preferences. - Allergies, intolerances, exclusions and
disliked foods. - Meal timing preferences and number/names of meal
slots. - Workout/rest-day classification, initially manual. - Multiple
named profiles or goal configurations, with one active profile. - Dated
measurements so history is not overwritten.

**Acceptance criteria** - A user can create and edit a profile. - A
profile can have its own targets and preferences. - Changing current
measurements does not erase historical measurements or past plans.

## 2.2 Food database

**MVP requirements** - Search Indian and international foods. - Support
ingredients, packaged foods, branded foods and custom foods. -
Distinguish raw, cooked, dried, drained and other relevant food
states. - Store food portions and serving conversions. - Store nutrient
values with units, source, source version and data status. - Allow
custom foods and corrections without silently modifying upstream source
records. - Search by name, category, source and brand where available.

**Initial data sources to evaluate** - ICMR-NIN Indian Food Composition
Tables (IFCT): Indian food composition, subject to access and reuse
terms. - USDA FoodData Central: broad food composition dataset and API;
verify dataset type and nutrient coverage per record. - Open Food Facts:
packaged-product information; review ODbL obligations, attribution and
share-alike implications before redistributing derived datasets. -
User-entered/custom foods and recipes.

**Data quality rules** - A missing nutrient is `unknown`, not zero. - A
known zero is distinct from a missing value. - Store provenance for each
imported food and nutrient value. - Do not merge foods solely because
names are similar. - Food state and preparation method must be
explicit. - Show data completeness/confidence indicators to the user. -
Avoid claiming a food has a nutrient deficiency or absence if the source
simply did not report that nutrient.

## 2.3 Recipe management

**MVP requirements** - Create recipes from food ingredients and
quantities. - Store preparation instructions, tags, serving count and
final cooked yield where known. - Calculate recipe totals and
per-serving nutrition. - Support editing and versioning. - Reuse recipes
in multiple meal plans. - Preserve the recipe version used by historical
plans.

**Acceptance criteria** - Changing an ingredient quantity updates the
current recipe calculation. - A new recipe version does not silently
change old planned meals. - Per-serving calculations use the defined
serving/yield method.

## 2.4 Meal planning

**Highest-priority MVP module**

-   Daily and weekly views.
-   User-defined meal slots: names, times, order and optional status.
-   Add individual foods or recipes to meals.
-   Edit quantities and units.
-   Copy meals, days and weekly templates.
-   Save reusable meal templates.
-   Add unstructured/untimed meals.
-   Support workout/rest-day labels.
-   Show meal, day and week nutrition totals.
-   Recalculate nutrition after changes.
-   Keep planned records separate from actual consumption.

**Acceptance criteria** - A user can plan all seven days
independently. - Adding or changing an ingredient updates meal/day
totals. - Meal slots are not hard-coded to breakfast/lunch/dinner. - A
user can duplicate a previous day and then edit it without changing the
source day.

## 2.5 Nutrition calculation engine

**MVP requirements** - Energy and macronutrients. - Vitamins and
minerals. - Fatty acids and amino acids where the selected source
provides values. - Other compounds where useful and reliably sourced. -
Ingredient-to-meal, recipe, day and week aggregation. - Unit
normalization and conversions. - Raw/cooked variants and edible-portion
handling. - Data completeness and unknown-value propagation. -
Deterministic calculations and documented rounding rules. - Snapshot
calculations for historical plans.

**Calculation baseline**

For a nutrient value expressed per 100 g edible portion:

`consumed nutrient = per-100-g value × edible quantity in grams / 100`

Recipe totals are the sum of ingredient contributions. Per-serving
values use the defined number of servings or final yield/portion weight.
Cooking water gain/loss means raw and cooked foods must not be treated
as interchangeable by simple weight scaling. Cooking retention factors
should only be applied when supported by appropriate data.

Use decimal-safe arithmetic for quantities and nutrient aggregation
where practical.

## 2.6 Nutritional target management

Each nutrient can have an independent target configuration.

**Supported target types** - Minimum. - Maximum. - Range. - Soft
target. - Informational/monitor-only.

**Configurable properties** - Minimum and maximum values. - Canonical
unit. - Priority: critical/high/moderate/low. - Evaluation period: daily
or weekly initially. - Applicable day type: all days, workout days or
rest days. - Display/pin setting. - Alert/flag behavior. - Reference
standard and source. - Custom user target. - Effective date/history.

**Reference standards** - RDA, AI, EAR, UL and AMDR must be
distinguished and not treated as interchangeable. - Store population
applicability, age range, sex applicability and source edition. - An EAR
is not an individual target; a UL is an upper safety boundary, not a
goal. - User-defined targets must be distinguishable from official
reference values. - The app should not diagnose deficiency from a single
day's food intake. Use language such as "below configured target" or
"potential dietary gap."

## 2.7 Nutrition analysis

**MVP requirements** - Compare planned daily/weekly intake with
targets. - Show below-target, within-range, above-limit and unknown
statuses. - Show nutrient data coverage. - Identify nutrients with
recurring gaps when enough history exists. - Provide food-based
suggestions in a later iteration; initial MVP may show simple
deterministic candidate foods. - Make the detailed nutrient explorer
searchable and categorized.

**Dashboard principle** - Show important/pinned nutrients first. - Keep
the full nutrient catalogue available in a detailed explorer. - Do not
crowd the landing page with every nutrient.

## 2.8 Actual consumption

**Basic MVP requirements** - Record actual foods/meals separately from
planned meals. - Mark a planned meal as consumed, partially consumed or
skipped as a convenience, but preserve actual quantities. - Edit actual
ingredient quantities. - Add unplanned food. - Preserve source and
timestamp. - Compare planned vs actual for energy and all available
nutrients.

Manual entry is required initially. Fud AI/Health Connect imports are
future integrations.

## 2.9 AI nutrition assistant

**Later phase** - Explain the user's planned nutrition and target
gaps. - Suggest ingredient substitutions. - Simulate meal changes before
applying them. - Suggest recipes using available ingredients and
preferences. - Generate a weekly plan subject to constraints. - Explain
uncertainty and missing food data.

**Safety/architecture rule:** AI must not invent nutrient values or be
the authoritative calculator. It should call deterministic backend tools
for food search, recipe calculation, target evaluation and meal-plan
simulation. Any modification to a plan requires user approval.

## 2.10 Future integrations

-   Fud AI diary import/export if supported and available.
-   Android Health Connect for permitted health/activity records.
-   Apple HealthKit only if a future native iOS app is built and
    authorized.
-   Do not assume Google Fit is the right new integration target; Google
    Fit APIs are being deprecated in favor of Health Connect on Android.
-   Preserve external source identifiers, consent, permissions and sync
    history.

------------------------------------------------------------------------

# 3. Application architecture

## 3.1 Recommended stack

  -----------------------------------------------------------------------
  Layer                   Recommendation          Rationale
  ----------------------- ----------------------- -----------------------
  Frontend                Next.js + TypeScript    Interactive, responsive
                                                  web UI

  UI                      Tailwind CSS +          Consistent reusable
                          shadcn/ui               components

  Client data             TanStack Query          API state and caching

  Backend                 FastAPI + Python        Typed REST API and
                                                  Python nutrition
                                                  ecosystem

  Validation              Pydantic                Request/response
                                                  validation

  ORM                     SQLAlchemy              Relational persistence

  Migrations              Alembic                 Controlled schema
                                                  evolution

  Initial database        SQLite                  Simple
                                                  local/single-user MVP

  Future database         PostgreSQL              Multi-user/deployed
                                                  scale

  Testing                 Pytest + frontend test  Deterministic
                          tooling                 calculation and UI
                                                  tests

  Version control         Git                     History and
                                                  collaboration

  CI                      GitHub Actions          Automated checks
  -----------------------------------------------------------------------

Avoid microservices. Use a modular monolith with clear service
boundaries. Do not add Redis, queues, vector databases or orchestration
frameworks until a demonstrated requirement exists.

## 3.2 Repository structure

``` text
nutriplan/
├── frontend/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── hooks/
│   └── lib/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── nutrition/
│   │   ├── integrations/
│   │   └── main.py
│   ├── migrations/
│   └── tests/
├── data/
│   ├── imports/
│   └── seed/
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATA_DICTIONARY.md
│   └── DECISIONS.md
└── README.md
```

## 3.3 High-level architecture

``` text
Next.js frontend
  ├── Dashboard
  ├── Meal planner
  ├── Food library
  ├── Recipe editor
  ├── Nutrition explorer
  └── Profile and targets
        |
        | REST / JSON
        v
FastAPI modular monolith
  ├── Profile service
  ├── Food service
  ├── Recipe service
  ├── Meal planning service
  ├── Nutrition calculation engine
  ├── Target evaluation service
  ├── Analysis service
  ├── Consumption service
  └── Integration/AI adapters (later)
        |
        +---- SQLite initially / PostgreSQL later
        |
        +---- Imported food datasets / approved APIs
```

The nutrition engine must be independent of the UI and orchestration.
Recipes, meal planning and AI should call the same deterministic
calculation functions.

## 3.4 Quantity-change workflow

1.  Frontend sends the updated food quantity.
2.  Backend validates quantity and unit.
3.  Nutrition engine calculates ingredient contribution.
4.  Meal service aggregates the meal.
5.  Day/week service aggregates the plan.
6.  Target service evaluates configured rules.
7.  Frontend refreshes the displayed totals and status.

## 3.5 Development commands

``` bash
# Frontend
cd frontend
npm run dev

# Backend, separate terminal
cd backend
uvicorn app.main:app --reload
```

Use environment variables for secrets and external API keys. Never
commit credentials.

------------------------------------------------------------------------

# 4. Food database strategy

## 4.1 Sources to evaluate

1.  **ICMR-NIN IFCT** --- Indian ingredients and regional relevance;
    verify licensing/access before import.
2.  **USDA FoodData Central** --- international food composition and
    API; retain data type and source identifiers.
3.  **Open Food Facts** --- packaged foods and barcodes; review ODbL
    attribution/share-alike obligations before redistribution.
4.  **Custom database** --- homemade recipes, custom ingredients,
    corrections and user-created foods.

## 4.2 Canonical model

A food can have multiple variants, such as raw rice and cooked rice.
Similar names do not imply equivalent nutrient profiles.

Store: - Canonical food identity. - Food variant/state. - Preparation
method. - Edible portion basis. - External source and source record
ID. - Nutrient values and units. - Nutrient value status: known, known
zero, unknown, not applicable or estimated. - Source version/import
timestamp.

Search ranking should favor exact Indian matches where appropriate, then
exact common/global foods, packaged foods and fuzzy matches. For
ambiguous results, let the user choose.

------------------------------------------------------------------------

# 5. Nutrition engine specification

## 5.1 Canonical quantities

-   Food weight: grams.
-   Volume: millilitres.
-   Energy: canonical kcal for app calculations/display, retaining
    source values where needed.
-   Each nutrient has a canonical unit and conversion rules.

## 5.2 Unknown values

Never coerce missing nutrient data to zero. Track known values and
completeness independently. If a meal includes ingredients with missing
vitamin data, the app must not confidently report a precise total as if
all ingredients were measured.

## 5.3 Recipe calculation

Sum the nutrient contribution of each ingredient. Calculate per serving
using servings or final cooked yield/portion weight. Preserve the method
and assumptions. Do not apply generic cooking retention factors without
reliable source data.

## 5.4 Testing

-   Doubling a food quantity doubles its known nutrient contribution.
-   Unit conversions preserve equivalent quantities.
-   Missing values remain unknown.
-   Known zero remains zero.
-   Recipe totals equal ingredient contribution sums within defined
    rounding tolerance.
-   Historical snapshots remain unchanged after food/recipe updates.

------------------------------------------------------------------------

# 6. Target engine specification

## 6.1 Example target types

  Type            Evaluation
  --------------- ----------------------------------------------------------
  Minimum         Intake must be at least the configured minimum
  Maximum         Intake must not exceed configured maximum
  Range           Intake should fall between lower and upper bounds
  Soft            Preferred goal; deviation is not treated as hard failure
  Informational   Display only; no pass/fail status

## 6.2 Evaluation statuses

-   `met`
-   `below`
-   `above`
-   `within_range`
-   `on_track`
-   `unknown`
-   `not_applicable`

Evaluation must account for unit, period, applicability, missing data
and target type. Weekly targets should be evaluated over the defined
weekly window rather than treated as a daily rule.

------------------------------------------------------------------------

# 7. Relational data model

Use relational tables for core data. JSON may be used for non-critical
extensible metadata, not as a substitute for normalized nutrient and
meal relationships.

## 7.1 User and profile

  -----------------------------------------------------------------------
  Table                               Key fields
  ----------------------------------- -----------------------------------
  `users`                             id, email, created_at

  `nutrition_profiles`                id, user_id, name, goal_type,
                                      activity_level, active

  `profile_measurements`              id, profile_id, date, weight_kg,
                                      height_cm

  `dietary_preferences`               id, profile_id, preference_type,
                                      value

  `food_restrictions`                 id, profile_id, food_id,
                                      restriction_type
  -----------------------------------------------------------------------

## 7.2 Food and nutrients

  -----------------------------------------------------------------------
  Table                               Key fields
  ----------------------------------- -----------------------------------
  `food_sources`                      id, source_name, source_version,
                                      license

  `foods`                             id, name, category, description,
                                      owner_id

  `food_variants`                     id, food_id, state,
                                      preparation_method

  `food_external_ids`                 id, food_variant_id, source_id,
                                      external_id

  `nutrients`                         id, code, name, category,
                                      canonical_unit

  `food_nutrients`                    id, food_variant_id, nutrient_id,
                                      value, status, source_id

  `food_portions`                     id, food_variant_id, description,
                                      weight_g

  `food_data_history`                 id, food_variant_id, source_id,
                                      imported_at, version
  -----------------------------------------------------------------------

## 7.3 Recipes

  -----------------------------------------------------------------------
  Table                               Key fields
  ----------------------------------- -----------------------------------
  `recipes`                           id, name, owner_id, instructions

  `recipe_versions`                   id, recipe_id, version, yield_g,
                                      servings

  `recipe_ingredients`                id, recipe_version_id,
                                      food_variant_id, quantity_g

  `recipe_tags`                       recipe_id, tag
  -----------------------------------------------------------------------

## 7.4 Meal planning

  -----------------------------------------------------------------------
  Table                               Key fields
  ----------------------------------- -----------------------------------
  `meal_plans`                        id, profile_id, name, start_date,
                                      end_date

  `planned_days`                      id, plan_id, date, day_type

  `meal_slots`                        id, planned_day_id, name,
                                      scheduled_time, position

  `planned_meals`                     id, meal_slot_id, name, notes

  `planned_meal_items`                id, planned_meal_id,
                                      food_variant_id or
                                      recipe_version_id, quantity_g

  `planned_nutrition_snapshots`       id, item_id, calculation_version,
                                      nutrient_snapshot
  -----------------------------------------------------------------------

A planned item references either a food variant or a recipe version, not
both. Enforce this with database/application constraints.

## 7.5 Nutritional targets

  -----------------------------------------------------------------------
  Table                               Key fields
  ----------------------------------- -----------------------------------
  `nutrient_references`               id, nutrient_id, standard,
                                      population, age ranges, source
                                      edition

  `reference_values`                  id, reference_id, value_type,
                                      minimum, maximum, unit

  `profile_nutrient_targets`          id, profile_id, nutrient_id,
                                      target_type, priority

  `target_schedules`                  id, target_id, evaluation_period,
                                      applicable_day_type

  `target_history`                    id, target_id, effective_from,
                                      effective_to, values
  -----------------------------------------------------------------------

## 7.6 Actual consumption

  -----------------------------------------------------------------------
  Table                               Key fields
  ----------------------------------- -----------------------------------
  `consumption_days`                  id, profile_id, date

  `consumed_meals`                    id, consumption_day_id, name, time

  `consumed_items`                    id, consumed_meal_id,
                                      food_variant_id, quantity_g

  `consumption_sources`               id, consumed_item_id, source_type,
                                      external_id
  -----------------------------------------------------------------------

Source types initially include `manual`; future sources may include
`fud_ai`, `health_connect` or other approved integrations.

## 7.7 Important database rules

1.  Use canonical units and explicit conversion rules.
2.  Use decimal-safe numeric types for quantities and nutrient
    aggregation.
3.  Never overwrite source data silently.
4.  Preserve recipe versions and historical plan snapshots.
5.  Preserve unknown nutrient values.
6.  Keep target definitions independent of food nutrient data.
7.  Add created/updated timestamps and appropriate foreign keys/indexes.
8.  Design for multiple users, even if the first deployment is personal.

------------------------------------------------------------------------

# 8. API design

  ------------------------------------------------------------------------------------
  Domain                  Endpoint                             Purpose
  ----------------------- ------------------------------------ -----------------------
  Profiles                `GET /api/profiles`                  List profiles

  Profiles                `PUT /api/profiles/{id}`             Update profile

  Foods                   `GET /api/foods/search?q=rice`       Search

  Foods                   `POST /api/foods`                    Create custom food

  Foods                   `GET /api/foods/{id}`                Food details

  Recipes                 `POST /api/recipes`                  Create recipe

  Recipes                 `GET /api/recipes/{id}`              Recipe details

  Recipes                 `POST /api/recipes/{id}/calculate`   Calculate nutrition

  Targets                 `GET /api/targets`                   Retrieve targets

  Targets                 `PUT /api/targets/{id}`              Update target

  Planner                 `GET /api/plans/{id}`                Retrieve plan

  Planner                 `POST /api/plans`                    Create plan

  Planner                 `POST /api/plans/{id}/meals`         Add meal

  Planner                 `PATCH /api/meal-items/{id}`         Update quantity

  Analysis                `GET /api/analysis/daily`            Daily analysis

  Analysis                `GET /api/analysis/weekly`           Weekly analysis

  Consumption             `POST /api/consumption`              Record actual intake

  Consumption             `GET /api/consumption/daily`         Retrieve actual intake

  Nutrition               `POST /api/nutrition/calculate`      Deterministic
                                                               calculation
  ------------------------------------------------------------------------------------

API responses should expose nutrient units, data completeness and
calculation/version metadata. Validate inputs with Pydantic and document
APIs through OpenAPI.

------------------------------------------------------------------------

# 9. User interface specification

## 9.1 Main navigation

1.  Dashboard.
2.  Meal Planner.
3.  Food Library.
4.  Recipes.
5.  Nutrition Analysis.
6.  Grocery Planner (later).
7.  Profile and Settings.

## 9.2 Dashboard

-   Daily calorie and macro summary.
-   Pinned nutrient target completion.
-   Micronutrient coverage.
-   Below-target and above-limit items.
-   Today's planned meals.
-   Planned vs actual comparison.
-   Weekly overview.

Show pinned/important nutrients first and make the full catalogue
searchable.

## 9.3 Meal planner

Three views: - Day: ingredient-level detail and editing. - Week:
seven-day schedule and templates. - Nutrition: day/week nutrient
summary.

Use a side panel for meal editing so users do not lose their calendar
context. The editor should support food search, quantity, unit, recipe
selection, nutrition preview and save/cancel.

## 9.4 Nutrition explorer

Categories: - Energy and macronutrients. - Fat-soluble vitamins. -
Water-soluble vitamins. - Major minerals. - Trace minerals. - Fatty
acids. - Amino acids. - Other compounds.

Each nutrient should show target, planned intake, actual intake,
difference, status, data completeness and reference source.

------------------------------------------------------------------------

# 10. AI design (later phase)

AI is an assistant/orchestrator, not the source of nutritional truth.

Potential deterministic tools: - `get_daily_nutrition` -
`get_nutritional_gaps` - `get_meal_plan` - `search_foods` -
`calculate_recipe` - `simulate_meal_change` - `update_meal_plan`

Workflow: 1. Retrieve the plan and target configuration. 2. Identify
gaps or constraints. 3. Search real food records. 4. Simulate
alternatives with the nutrition engine. 5. Show the nutritional and
calorie trade-offs. 6. Ask for approval. 7. Apply changes only after
approval.

Do not let an LLM invent nutrient values or silently alter a meal plan.

------------------------------------------------------------------------

# 11. Future health-data integration: Health Connect and Fud AI

This is a future integration, not an MVP dependency.

## 11.1 Android Health Connect

Health Connect is Android's on-device health-data layer. A compatible
Android app can request user permission to read/write supported record
types, such as nutrition, hydration, weight, exercise and activity data.
Availability depends on the record type, Android version, app
implementation and user consent.

A web-only Next.js application cannot directly use the Android Health
Connect SDK. If Health Connect integration is required, the product will
need a companion Android application or a trusted native bridge that the
user installs and authorizes.

Suggested architecture: - NutriPlan web app: planning, targets and
analysis. - Android companion app: Health Connect permissions and data
access. - Secure sync API: receives only explicitly authorized
records. - Integration adapter: maps source records into NutriPlan's
actual-consumption and measurement models. - Sync history: records
source IDs, timestamps, permissions and import status.

Do not request broad permissions unnecessarily. Use the minimum record
types needed and provide clear disconnect/delete controls.

## 11.2 Fud AI

Do not assume Fud AI has a public API or that it writes all its data to
Health Connect. Verify: 1. Whether the installed Fud AI version supports
Health Connect. 2. Which record types it reads or writes. 3. Whether
nutrition logs are exported as Health Connect nutrition records or only
retained inside Fud AI. 4. Whether diary export/import is available and
what format it uses. 5. Whether a supported API or documented export
mechanism exists.

If Fud AI writes nutrition records to Health Connect, the Android
companion may be able to read permitted records. If it does not, use a
supported export/import route if available. Avoid scraping app databases
or relying on undocumented endpoints.

## 11.3 Google Fit

For a new Android integration, prefer Health Connect rather than
starting with Google Fit APIs. Google has been transitioning developers
away from Google Fit APIs toward Health Connect. Recheck current API
status before implementation.

## 11.4 Apple ecosystem

If a native iOS companion is added later, Apple HealthKit is the
corresponding health-data framework. It requires a native app and
user-granted permissions; a normal web page cannot directly query
HealthKit.

## 11.5 Integration data principles

-   Actual consumption must remain distinct from planned meals.
-   Keep source identifiers and original timestamps.
-   Prevent duplicate imports using source IDs/idempotency keys.
-   Respect timezone and meal-date boundaries.
-   Record permission state and sync history.
-   Never silently overwrite manual entries.
-   Allow users to revoke access and remove imported data.

------------------------------------------------------------------------

# 12. Non-functional requirements

  Area              Requirement
  ----------------- ----------------------------------------------------
  Performance       Meal recalculation should feel immediate
  Accuracy          Deterministic and testable calculations
  Reliability       Historical plans remain reproducible
  Privacy           Personal nutrition data kept private
  Portability       Complete export and backup
  Maintainability   Modular backend and typed API
  Security          Input validation, authentication before deployment
  Accessibility     Keyboard-friendly and readable UI
  Responsiveness    Desktop-first, mobile usable
  Extensibility     Add data sources/integrations without redesign

------------------------------------------------------------------------

# 13. MVP development roadmap

Estimated duration: approximately 6--8 weeks of focused solo
development, assuming an initially curated dataset and no full-scale
external data ingestion project.

## Week 1 --- Foundation

-   Create Next.js and FastAPI projects.
-   Configure SQLite, SQLAlchemy and Alembic.
-   Define initial schema.
-   Implement profile management.
-   Build navigation and application layout.

**Deliverable:** Running application with persistent profile data.

## Week 2 --- Food database

-   Implement food, variant and nutrient tables.
-   Import a small licensed Indian ingredient dataset.
-   Integrate USDA search.
-   Add custom food creation.
-   Implement food search and serving units.

**Deliverable:** Searchable food library.

## Week 3 --- Nutrition engine and recipes

-   Implement nutrient calculations and unit conversion.
-   Add unknown nutrient handling.
-   Implement recipe creation and versioning.
-   Add serving calculations.
-   Write automated calculation tests.

**Deliverable:** Reliable ingredient and recipe calculations.

## Weeks 4--5 --- Meal planner

-   Build day/week views.
-   Add customizable meal slots.
-   Implement meal creation and editing.
-   Add foods and recipes.
-   Add quantity adjustments and templates.
-   Connect live nutrition calculations.

**Deliverable:** Functional daily and weekly meal planner.

## Week 6 --- Targets and nutrition analysis

-   Implement reference-value tables.
-   Implement custom target types and priorities.
-   Add daily/weekly evaluation.
-   Build nutritional gap analysis.
-   Add macro/micronutrient dashboards and completeness indicators.

**Deliverable:** Nutritional evaluation of planned meals.

## Week 7 --- Actual vs planned

-   Add actual consumption records.
-   Support partial and unplanned intake.
-   Build planned-vs-actual comparisons.
-   Add daily and weekly summaries.

**Deliverable:** Planning and consumption comparison.

## Week 8 --- Stabilization

-   Improve responsive design.
-   Add export/backup.
-   Test historical plan preservation.
-   Test missing nutrient handling.
-   Improve error handling and search.
-   Document setup and deployment.

**Deliverable:** Usable personal MVP.

## Post-MVP

  Phase     Features
  --------- -----------------------------------------------------
  Phase 2   AI assistant, meal optimization, food substitutions
  Phase 3   Grocery planning, pantry, budget
  Phase 4   Fud AI import and Health Connect companion
  Phase 5   Advanced analytics, trends and dietary variety

------------------------------------------------------------------------

# 14. MVP acceptance checklist

-   [ ] Add 100 g of a food and show its known nutrient values.
-   [ ] Increase to 150 g and recalculate all values.
-   [ ] Create a recipe and aggregate ingredient nutrients.
-   [ ] Change a recipe and preserve historical versions.
-   [ ] Create and edit a seven-day meal plan.
-   [ ] Configure a minimum target and evaluate it.
-   [ ] Configure a maximum target and flag excess.
-   [ ] Disable a target and exclude it from evaluation.
-   [ ] Show missing nutrient values as unknown, not zero.
-   [ ] Record actual quantities independently.
-   [ ] Compare planned and actual nutrient totals.
-   [ ] Export and restore application data.
-   [ ] Verify historical calculations remain reproducible.

------------------------------------------------------------------------

# 15. First development milestone

**Milestone 1: Working nutrition planner**

The user must be able to: 1. Open the web application. 2. Create a
nutrition profile. 3. Search for an ingredient. 4. Add it to a meal. 5.
Change its quantity. 6. See calories, macros and available
micronutrients. 7. See cumulative nutrition for the entire day.

**Definition of done:** A working meal planner with traceable and tested
nutrition calculations.

Do not start with AI, grocery planning or Health Connect. Prove the food
model, calculation engine and meal-planning experience first.

------------------------------------------------------------------------

# 16. Decision log and change policy

This plan is a baseline, not a permanent commitment.

  -----------------------------------------------------------------------
  Decision                Current choice          Revisit when
  ----------------------- ----------------------- -----------------------
  Product focus           Planning-first          User workflow changes

  Platform                Web                     Native health
                                                  integration is
                                                  prioritized

  Frontend                Next.js + TypeScript    Material technical
                                                  constraint appears

  Backend                 FastAPI + Python        Material technical
                                                  constraint appears

  Database                SQLite initially        Multi-user/deployment
                                                  requirements grow

  Architecture            Modular monolith        Actual scaling need
                                                  exists

  Food data               IFCT + USDA + Open Food Licensing/coverage
                          Facts + custom          evaluated

  Fud AI                  Future integration      Supported interface is
                                                  verified

  Health Connect          Future Android          Integration scope is
                          companion               confirmed

  AI                      Post-MVP                Core calculations are
                                                  stable
  -----------------------------------------------------------------------

For each future change, record: - Date. - What changed. - Why it
changed. - Impact on schema, API, UX and roadmap. - Whether old
behavior/data needs migration.

**Current status:** Requirements and architecture proposed; no
application implementation has started. The 6--8 week estimate is
provisional.


---

# 17. Integration update — Fud AI through Android Health Connect

**Update date:** 10 November 2026  
**Status:** Verified direction; implementation remains future scope.

Fud AI's current product information states that it optionally integrates with Android Health Connect and can sync meal nutrition, weight/body measurements and workouts/calculated workout calories. Its product information also mentions daily step reads for its own Home experience. Confirm the exact records and fields emitted by the installed Fud AI version during implementation; do not assume every metric is written to Health Connect.

This changes the integration plan: Health Connect is a realistic bridge for Fud AI nutrition records, not merely a speculative future possibility.

## 17.1 Recommended data flow

```text
Fud AI
  |
  | User enables Health Connect sync
  v
Android Health Connect (on-device health data store)
  |
  | User authorizes NutriPlan companion app
  v
NutriPlan Android companion
  |
  | Authenticated, minimal, idempotent sync
  v
NutriPlan backend
  |
  v
NutriPlan web application
  - Actual nutrition
  - Weight/body measurements
  - Workout/activity context
  - Planned vs actual comparison
```

The web app remains the primary product. The Android companion is a narrow integration adapter and does not need to duplicate the web UI.

## 17.2 Why a companion app is required

Health Connect is an Android on-device API. A normal browser-based Next.js application cannot directly query the Health Connect SDK. A native Android component is required to request Health Connect permissions and read records.

Possible implementation choices:
- A small native Kotlin Android companion (recommended for the integration).
- A cross-platform wrapper only if it provides reliable access to the official Health Connect SDK and permission model.

Do not add a full native application unless the integration proves valuable.

## 17.3 Health Connect data model

Health Connect has a `NutritionRecord` for food/meal nutrient information. Its fields include energy, protein, total carbohydrate, total fat, dietary fiber, sugar, sodium, cholesterol, selected fatty acids, and multiple vitamins/minerals. The record also includes a food/drink name, meal type, start/end times and metadata. Optional fields may be absent.

Other relevant record types may include:
- Weight and body measurements.
- Exercise sessions and related activity records.
- Steps and energy-related records.

The exact read permissions must be declared and requested individually. Request only record types needed for a visible product feature. A permission being available does not mean Fud AI writes that record type.

## 17.4 Integration implementation sequence

1. Inspect Fud AI's Health Connect settings and enable only the required sync categories.
2. Use Health Connect's own data-permission UI to verify which records Fud AI actually writes.
3. Build a minimal Android proof of concept that reads a short date range of NutritionRecord entries.
4. Inspect source metadata, timestamps, meal type, nutrient fields and missing values.
5. Map the records into NutriPlan's `consumed_meals`, `consumed_items` and measurement tables.
6. Add stable source identifiers and idempotency keys to prevent duplicate imports.
7. Add authenticated upload to the NutriPlan backend.
8. Add sync history, error handling, date-range selection and user disconnect/delete controls.
9. Test edits, deletions, partial nutrient fields, timezone boundaries and duplicate records.

## 17.5 Important limitations

- Health Connect stores structured health records, not necessarily Fud AI's complete diary database or every ingredient-level detail.
- A NutritionRecord may represent a meal or food item with nutrient totals; it does not guarantee a complete ingredient breakdown or the original Fud AI photo, prompt, recipe or serving calculation.
- Health Connect only exposes records that an app has written and that the user has permitted NutriPlan to read.
- A record's missing nutrient field is unknown, not zero.
- Health Connect record metadata and origin should be retained to identify the contributing app.
- Do not assume that all Fud AI edits/deletions are mirrored in a way that can be reconstructed without testing.
- Do not scrape Fud AI's local database or use undocumented endpoints.

Therefore, the integration should be treated as an **actual-consumption summary/record import**, not a guaranteed lossless copy of the Fud AI diary. If ingredient-level fidelity is required, retain a separate supported diary JSON import path if available.

## 17.6 Google Fit vs Health Connect vs Google Health API

For a new Android on-device integration, prefer Health Connect over starting a new Google Fit integration. Google's developer migration guidance says Google Fit APIs are supported only until the end of 2026 and recommends Health Connect for mobile-first, on-device Android data. For web-centric cloud integrations involving Fitbit/Google device data, Google points developers toward the Google Health API. These are distinct integration paths and should not be conflated.

NutriPlan's immediate Fud AI use case is Android on-device data sharing, so Health Connect is the relevant first path.

## 17.7 Revised roadmap placement

Keep Health Connect outside the initial web-only MVP, but make the schema integration-ready from day one.

Suggested sequence:
- MVP: manual actual-consumption records and source metadata.
- Integration spike: verify Fud AI → Health Connect record coverage.
- Phase 2/3: build minimal Android companion and secure sync.
- Later: evaluate Google Health API only if Fitbit/cloud device data becomes a separate requirement.

## 17.8 Updated decision log

| Decision | Updated choice |
|---|---|
| Main application | Web app remains primary |
| Fud AI data route | Prefer Fud AI → Health Connect → Android companion → NutriPlan backend |
| Health Connect | Concrete future integration, subject to proof-of-concept validation |
| Google Fit | Do not start a new integration against deprecated Fit APIs |
| Actual intake | Store imported Health Connect records as actual consumption, separately from planned meals |
| Diary fidelity | Health Connect may not preserve full ingredient-level diary details; retain a separate supported export/import option if needed |

