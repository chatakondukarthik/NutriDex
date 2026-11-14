# NutriPlan --- MVP Product Specification & Decision Register

**Document version:** 0.3\
**Last updated:** 12 November 2026\
**Document status:** Working specification\
**Purpose:** Single source of truth for product decisions, requirements,
workflows, open questions and scope.

------------------------------------------------------------------------

## 1. How this document is maintained

This document replaces the loose, changing numbered requirements tracker
as the primary planning record.

It deliberately separates:

  -----------------------------------------------------------------------
  Record type                         Meaning
  ----------------------------------- -----------------------------------
  **Agreed decision**                 The user has explicitly accepted
                                      the direction. Treat it as the
                                      current product rule unless it is
                                      deliberately revisited.

  **Requirement**                     A capability or behaviour the MVP
                                      needs. It may be agreed, proposed
                                      or still under refinement.

  **Proposed direction**              A recommendation that has not yet
                                      been accepted. It must not be
                                      treated as a final requirement.

  **Open question**                   A decision that still needs
                                      discussion or evidence.

  **Deferred**                        Intentionally outside the current
                                      MVP-design focus. It may be
                                      revisited later.
  -----------------------------------------------------------------------

### Status vocabulary

-   **Agreed** --- explicitly accepted.
-   **In discussion** --- being refined; not final.
-   **Proposed** --- suggested but not accepted.
-   **Open** --- not yet resolved.
-   **Deferred** --- intentionally postponed.
-   **Drafted** --- a workflow or test scenario exists, but has not
    necessarily been approved in full.

### Change-control rules

1.  When a decision is explicitly agreed, update the relevant section
    and the Decision Register in this document in the same revision.
2.  Do not create a new tracker row every time a detail is discussed.
    Keep requirements grouped by product area.
3.  Do not renumber or delete decision IDs. If a decision changes, mark
    the old decision as superseded and add a new decision that
    references it.
4.  Keep proposed behaviour separate from agreed behaviour.
5.  Record the reasoning and practical consequences of important
    decisions, not just a one-line status.
6.  A drafted flow is not automatically an approved flow.
7.  Do not silently turn an assumption, example or recommendation into a
    product rule.
8.  Update the document incrementally after each meaningful decision. Do
    not wait until an entire module is complete.

------------------------------------------------------------------------

## 2. Product vision

**NutriPlan is a personal nutrition-first planning application that
helps ordinary people understand, plan and track their nutrition without
needing nutritional expertise.**

The product should feel like a helpful personal companion rather than a
complicated nutrition spreadsheet. Nutrition is the starting point; the
architecture and product direction should leave room to expand into
broader personal health capabilities later.

### Core product outcomes

NutriPlan should help a user:

-   Identify foods they eat and understand their nutritional
    composition.
-   Reuse foods and recipes without repeatedly entering the same
    information.
-   Create and adjust recipes using ingredients, quantities and
    preparation details.
-   Plan meals across a day or week.
-   See nutrition calculations update when foods, quantities,
    ingredients or substitutions change.
-   Record what they actually consumed, whether or not it was planned.
-   Understand the difference between planned and actual nutrition.
-   Use AI to make food entry, recipe creation and nutrition
    interpretation easier.

### Product boundaries

The initial product is not intended to be:

-   A medical diagnosis or treatment application.
-   A workout or exercise tracker.
-   A tool that expects users to understand nutrition science or
    manually enter nutrient values.
-   An unconstrained AI chatbot that invents nutritional values without
    evidence.

Onboarding, account setup, profile configuration and the detailed
target-setup experience are intentionally set aside while the core
application workflows are being designed. They are not being rejected as
product capabilities; they are simply not the current discussion focus.

------------------------------------------------------------------------

## 3. Product design principles

  -----------------------------------------------------------------------
  Principle                           Product interpretation
  ----------------------------------- -----------------------------------
  User-friendly first                 Casual users should not need
                                      nutrition expertise to use the app.

  Accuracy with transparency          Use the best available data and
                                      disclose assumptions and
                                      uncertainty.

  AI-assisted, data-first             AI should make existing data easier
                                      to use, not bypass data quality.

  Flexible foods and recipes          Support variations in ingredients,
                                      quantities and preparation.

  Minimal unnecessary input           Ask for details only when they
                                      materially affect the result.

  Reusable information                Let users save and reuse foods and
                                      recipes.

  Explainable estimates               Make it possible to see the
                                      reference data and estimation
                                      rationale.

  Expandable architecture             Start with a manageable
                                      implementation without blocking
                                      future capabilities.
  -----------------------------------------------------------------------

**Guiding principle:** Simplify the user's experience, not necessarily
the complexity inside the system. NutriPlan may perform detailed
calculations internally while presenting a straightforward result.

------------------------------------------------------------------------

## 4. Core application areas

The current workflow-design focus is limited to four connected areas:

1.  **Food management** --- identify, resolve, review, use and
    optionally save foods.
2.  **Recipe management** --- create, edit, calculate and reuse recipes.
3.  **Meal planning** --- arrange foods and recipes into planned meals.
4.  **Consumption and tracking** --- record what was actually eaten and
    understand nutrition over time.

Nutrition calculation and AI assistance are cross-cutting capabilities
used by these workflows. They are not separate user journeys that the
user must complete before using the app.

The application should not force a single linear journey. For example:

-   A user should be able to log food without first creating a meal
    plan.
-   A user should be able to plan a meal without manually building a
    large food library first.
-   A food can be used immediately without being saved permanently to
    the personal library.
-   Recipes and foods should be independently reusable.
-   Actual consumption must remain distinct from planned consumption.

The detailed navigation and connections between these areas remain to be
designed.

------------------------------------------------------------------------

## 5. Decision Register

This is the durable record of what has been agreed. IDs are stable and
should not be renumbered.

### D-001 --- Product is nutrition-first, with room to expand

**Status:** Agreed

NutriPlan starts with nutrition planning and tracking. Broader health
capabilities may be added later, but should not complicate the initial
product.

**Why it matters:** Keeps the first product coherent while avoiding an
architecture that makes future expansion unnecessarily difficult.

### D-002 --- User experience should hide unnecessary nutrition complexity

**Status:** Agreed

Casual users should not need to know nutrition terminology, select every
technical attribute or manually enter nutrient values. The system should
make sensible choices where defensible and allow corrections.

**Why it matters:** A technically accurate system is not useful if
ordinary users cannot operate it comfortably.

### D-003 --- Use a layered conceptual food model

**Status:** Agreed direction; detailed schema remains open

Food information should distinguish:

1.  **Base food identity** --- what the food is, such as banana, milk,
    paneer or carrot.
2.  **Characteristics and state** --- what makes the selected food
    different, such as size, ripeness, fat level or preparation.
3.  **Nutrition profile** --- the sourced, calculated or estimated
    nutritional information associated with the selected food.

Do not build a separate elaborate subsystem for every possible
variation. Support extensible characteristics and introduce specific
rules when real use cases justify them.

### D-004 --- Unknown food attributes must be allowed

**Status:** Agreed

The user should not be forced to specify a variety, ripeness,
preparation detail or other characteristic they do not know. Unknown is
a valid state.

The system should distinguish:

-   **Explicit:** supplied by the user.
-   **Defaulted:** selected by the system as a reasonable default.
-   **AI-inferred:** interpreted from the user's description or context.
-   **Unknown:** not known or not sufficiently supported.

Defaults and inferences should be visible and correctable. They must not
be presented as confirmed facts.

### D-005 --- Some apparent variations are separate food identities or preparation states

**Status:** Agreed examples and modelling rule

Examples:

-   Fresh garlic and garlic powder are separate food identities.
-   Raw rice and cooked rice are distinct preparation states/records for
    nutrition matching.
-   Regular paneer and low-fat paneer are different variants.
-   Curd and paneer are distinct foods.

Similar names alone are not sufficient reason to merge food records.

### D-006 --- Use a hybrid cooking model

**Status:** Agreed

Cooking information can be captured at two levels:

**Ingredient-level preparation** - Examples: carrot raw/chopped; potato
peeled/boiled; onion sliced; oil added. - Each ingredient can have its
own preparation state.

**Recipe-level preparation** - Examples: simmering, frying, baking,
added ingredients, final cooked weight and serving count. - Represents
the overall cooking process and final recipe outcome.

Do not force users to provide exact temperatures, durations or
moisture-loss measurements unless those details materially affect the
calculation. AI may interpret instructions and suggest preparation
details for the user to review.

Avoid applying a cooking adjustment twice when the selected food record
already represents the cooked state. Use validated yield and
nutrient-retention data where available.

### D-007 --- Nutrition estimates must be evidence-led and transparent

**Status:** Agreed

Use the best available estimate and disclose uncertainty. Ask for
cooking method or other details when they materially affect the result.
Use defensible defaults and approximate matches where appropriate. Do
not ask users to manually enter nutrient values.

The system must support an insufficient-evidence state. It must not
fabricate precision simply to fill every nutrient field.

### D-008 --- Nutrition data provenance exists at nutrient level

**Status:** Agreed

Each nutrient value should be distinguishable as:

-   **Sourced:** retrieved from a database or verified product label.
-   **Calculated:** derived through deterministic calculations.
-   **Estimated:** inferred from available evidence.

This distinction belongs at the individual nutrient level, not only at
the overall food-record level. Preserve original sourced values
separately from estimates and adjustments.

### D-009 --- AI interprets; the nutrition engine resolves and calculates

**Status:** Agreed

AI responsibilities include natural-language interpretation, food
identification, attribute extraction, defaults, food matching, recipe
interpretation, substitutions, estimation assistance and explanations.

The nutrition engine is responsible for retrieving records, applying
validated calculations and cooking adjustments, calculating recipe
totals and per-serving values, checking units and consistency,
maintaining provenance and uncertainty, preserving historical values,
and recalculating when ingredients or quantities change.

AI must not automatically overwrite known nutrition values. LLM
self-reported confidence is not scientific confidence; confidence should
be based on evidence quality, data coverage and validated performance.

### D-010 --- Show a reference food when the exact variant is unavailable

**Status:** Agreed direction; exact interface behaviour remains open

When an exact food variation is unavailable, show the selected food and
the reference food used for estimation. Disclose which values are
sourced and which are estimated, and explain the assumptions.

An expandable explanation such as "How was this calculated?" is part of
the intended direction.

Whether users should be able to switch between the reference profile and
the estimated profile remains an open UI decision.

### D-011 --- Food-entry methods converge into one resolution workflow

**Status:** Agreed

Food can be initiated through different entry methods:

-   Search an existing food database.
-   Describe the food in natural language for AI interpretation.
-   Scan a barcode or upload a packaged-food label.
-   Create a custom food.

These are different entry points, not four unrelated end-to-end systems.
They should converge on a common food-identification and resolution
process, followed by relevant characteristics, quantity, nutrition
calculation and review.

**Why it matters:** The interface can accommodate different user
behaviours without duplicating food-resolution logic.

### D-012 --- Using a food and saving it to the personal library are separate actions

**Status:** Agreed

A user should be able to add a food to a meal or consumption log without
being forced to save it permanently to their personal food library.
Saving for reuse should be available as a separate action. A user may
choose to do both.

------------------------------------------------------------------------

## 6. Food management workflow

### 6.1 Current agreed structure

The four entry methods converge into a shared workflow:

``` mermaid
flowchart TD
    A[User wants to add a food] --> B{Entry method}
    B --> C[Search food database]
    B --> D[Describe food to AI]
    B --> E[Scan barcode or upload label]
    B --> F[Create custom food]

    C --> G[Identify and resolve food]
    D --> G
    E --> G
    F --> G

    G --> H{Suitable food match?}
    H -->|Yes| I[Select or confirm food]
    H -->|No| J[Create provisional or custom record]

    I --> K[Select relevant characteristics]
    J --> K
    K --> L[Specify quantity and unit]
    L --> M[Calculate nutrition]
    M --> N[Review food and nutrition]

    N --> O{Next action}
    O --> P[Add to meal or consumption log]
    O --> Q[Save to personal food library]
    O --> R[Do both]
```

This is the current agreed high-level structure. It is not yet a
complete screen-by-screen interaction specification.

### 6.2 Required behaviour

-   Support all four entry methods.
-   Resolve the food to an existing record when a suitable match exists.
-   Allow a custom or provisional record when no suitable match exists.
-   Ask for or infer only relevant characteristics.
-   Preserve explicit, defaulted, AI-inferred and unknown attribute
    states.
-   Capture quantity and unit before calculating the consumed/used
    amount.
-   Show the resulting nutrition and relevant assumptions for review.
-   Allow the user to use the food immediately without saving it to the
    personal library.
-   Allow saving for later reuse, independently of adding it to a meal
    or log.

### 6.3 Still to specify

-   Search ranking, match selection and duplicate handling.
-   Which characteristics are relevant for each food.
-   Portion units and household measures.
-   How quantity is inferred from natural-language descriptions.
-   How custom records are edited, saved, reused and corrected.
-   Packaged-label OCR, verification and barcode behaviour.
-   Whether and how recently used food variants are retained
    automatically.
-   Exact nutrition-review UI and uncertainty presentation.

------------------------------------------------------------------------

## 7. Recipe management workflow

### 7.1 Current proposed structure

The following is a draft workflow, not a fully agreed recipe
specification:

``` mermaid
flowchart TD
    A[User wants to create or add a recipe] --> B{Entry method}
    B --> C[Create manually]
    B --> D[Describe recipe to AI]
    B --> E[Import or paste recipe]

    C --> F[Build editable recipe]
    D --> F
    E --> F

    F --> G[Identify ingredients]
    G --> H[Set ingredient quantities]
    H --> I[Specify relevant ingredient preparation]
    I --> J[Specify cooking method and additions]
    J --> K[Calculate ingredient nutrition]
    K --> L[Calculate final recipe yield]
    L --> M[Calculate total and per-serving nutrition]
    M --> N[Review recipe]
    N --> O[Save recipe]
```

Manual entry, AI description and import are proposed entry routes. Their
detailed behaviour and inclusion in the MVP remain to be confirmed.

### 7.2 Requirements and design considerations

A recipe may need to represent:

-   Ingredients and their quantities.
-   Food identity and relevant characteristics for each ingredient.
-   Ingredient-level preparation.
-   Recipe-level cooking method and additions.
-   Final cooked weight or yield where relevant.
-   Number of servings or serving weight.
-   Total recipe nutrition and nutrition per serving.
-   Ingredient substitutions and recipe variations.
-   A saved, reusable recipe record.

The nutrition calculation should use the ingredient food records and
quantities, apply relevant cooking/yield adjustments without
double-counting them, and make total and per-serving nutrition
available.

### 7.3 Open recipe decisions

1.  **What counts as a recipe?** Should simple combinations such as
    milk + cereal and basic preparations such as boiled eggs use the
    same recipe system as multi-ingredient dishes such as paneer bhurji
    or biryani? A unified underlying model with a simpler interface for
    simple cases has been recommended, but not yet approved.
2.  **Entry methods:** Confirm manual entry, AI-described recipe
    creation and import/paste as MVP routes.
3.  **Recipe complexity:** Decide how the interface adapts so simple
    combinations do not require cooking steps.
4.  **Yield and servings:** Decide how final cooked weight, number of
    servings and user-entered serving weight interact.
5.  **Variations and substitutions:** Define whether edits change the
    original recipe, create a new version or create a variation.
6.  **Version history:** Preserve historical recipe calculations when a
    saved recipe changes; exact versioning behaviour remains to be
    specified.

------------------------------------------------------------------------

## 8. Nutrition engine requirements

### 8.1 Food representation

The conceptual model distinguishes base food,
characteristics/preparation and nutrition profile. The exact database
schema is not yet decided.

Examples of characteristics that may matter:

  Food      Potential characteristics
  --------- ---------------------------------------
  Banana    Size, variety, ripeness
  Milk      Whole, toned, skimmed, fat percentage
  Paneer    Regular, low-fat, homemade
  Rice      Variety, raw/cooked
  Potato    Skin on/peeled, boiled/roasted
  Chicken   Breast/thigh, skinless/skin-on
  Garlic    Fresh/dried/powdered
  Bread     Whole wheat/white/multigrain, toasted

This is an illustrative set, not a commitment to implement every
characteristic at launch.

### 8.2 Nutrition resolution modes

  -----------------------------------------------------------------------
  Mode                                Expected behaviour
  ----------------------------------- -----------------------------------
  **Direct**                          An appropriate exact nutrition
                                      record exists; use it.

  **Assisted**                        Partial or approximate information
                                      exists; preserve known values and
                                      estimate only unresolved or
                                      materially affected nutrients.

  **Fallback**                        No suitable record exists; create a
                                      provisional evidence-based estimate
                                      and clearly disclose its
                                      limitations.

  **Insufficient evidence**           Evidence is not adequate for a
                                      defensible estimate; do not
                                      fabricate a precise value.
  -----------------------------------------------------------------------

### 8.3 Estimation and validation

The intended processing pattern is:

1.  Retrieve the best available food record or records first.
2.  Pass the relevant record, provenance, missing/conflicting fields and
    user-described variation to the AI estimation step.
3.  Identify which nutrients are plausibly affected by the variation.
4.  Estimate only those nutrients for which evidence supports an
    adjustment.
5.  Preserve known values unless a defensible adjustment is available.
6.  Validate units, plausible ranges, energy/macro consistency and other
    rules through deterministic logic.
7.  Store source, method/model version and provenance for the resulting
    values.
8.  Retain the original data and calculation history for auditability.

The exact estimation algorithm, confidence calibration, source-priority
policy and validation thresholds remain open.

### 8.4 Reference comparison

When the exact variant is missing, the product should explain which
reference food was used and which nutrient values are sourced,
calculated or estimated. Illustrative numbers must not be presented as
validated food profiles.

------------------------------------------------------------------------

## 9. Core workflows still to design

### 9.1 Meal planning --- open

The meal-planning workflow has not yet been designed or approved.

Known product direction from the working baseline includes:

-   Daily and weekly meal planning.
-   Meal slots.
-   Adding foods and recipes to planned meals.
-   Nutrition recalculation when meal contents or quantities change.
-   Reusable meal plans and meal rotation.
-   A way to inspect nutrition while building or adjusting a plan.

These are scope candidates, not a finalized interaction flow. The user
should not be required to create a personal food library before planning
a meal.

### 9.2 Actual consumption and tracking --- open

This workflow must be designed independently of meal planning.

Known product direction includes:

-   Record foods and recipes actually consumed.
-   Support consumed, partially consumed, skipped and manually added
    items.
-   Allow logging even when no planned meal exists.
-   Keep planned meals separate from actual consumption.
-   Support later comparison between planned and actual nutrition.

Exact logging interactions, partial-consumption behaviour and
editing/history rules remain open.

### 9.3 Planned versus actual --- open

The product should eventually compare planned nutrition with actual
consumed nutrition across useful time periods. The exact metrics,
visualizations and treatment of unplanned food remain to be decided.

### 9.4 Nutrition targets and dashboard --- deferred in current workflow discussions

Targets, onboarding/profile setup, dashboard structure and account
configuration are not being designed in the current core-workflow
discussion. They remain part of the broader product scope and should be
revisited after the core workflows are understood.

------------------------------------------------------------------------

## 10. Food data sources and packaged products

Potential sources to evaluate:

-   ICMR-NIN Indian Food Composition Tables (IFCT).
-   USDA FoodData Central.
-   Open Food Facts, subject to licensing, attribution and data-quality
    review.
-   Verified product labels.
-   User-created and custom food records.

No final source hierarchy or licensing decision has been made.

Data rules carried forward from the working baseline:

-   Missing nutrient values must remain unknown, not be silently
    converted to zero.
-   Food records should retain source and version information.
-   Raw, cooked, dried and drained states must not be accidentally
    merged.
-   Similar names alone are insufficient to merge records.
-   Conflicting source values require an explicit source-selection
    policy.

Packaged-food label extraction and barcode support are intended
capabilities, but the detailed workflow and verification requirements
remain open.

------------------------------------------------------------------------

## 11. Initial acceptance-test scenarios

These scenarios are a working test suite for discovering and validating
requirements. They do not mean every associated feature is already fully
specified.

  -----------------------------------------------------------------------
  ID                      Scenario                Behaviour to validate
  ----------------------- ----------------------- -----------------------
  F01                     Two eggs and two slices Food identification,
                          of toasted whole wheat  quantity and
                          bread                   preparation

  F02                     User says a banana is   Attribute refinement
                          overripe                and estimation

  F03                     Toned milk with         Multiple food
                          Bournvita               identification and
                                                  portions

  F04                     Rice with dal and ghee  Ingredient
                                                  identification and
                                                  quantity assumptions

  F05                     Paneer bhurji with      Recipe identification
                          homemade curd           and distinct food
                                                  records

  F06                     Very ripe, almost black Map natural-language
                          banana                  description to
                                                  supported attributes

  F07                     Milk changed to skimmed Variant replacement and
                                                  recalculation

  F08                     Fresh garlic replaced   Distinct food identity
                          with powder             and substitution

  F09                     Low-fat homemade paneer Match or fallback
                                                  estimation

  F10                     Skinless chicken thigh  Food variant matching

  F11                     200 g raw carrots,      Cooking transformation
                          boiled                  

  F12                     Boiled carrots with     Cooking-related
                          cooking water discarded nutrient loss

  F13                     Vegetables cooked in 10 Added ingredient and
                          g oil                   recipe yield

  F14                     Roasted potatoes with   Preparation and edible
                          skin                    portion

  F15                     Vegetable curry with    Recipe yield and
                          600 g final weight      serving calculations

  F16                     Exact food record       Exact-match priority
                          exists                  

  F17                     Only an approximate     Reference comparison
                          match exists            and disclosed
                                                  assumptions

  F18                     No suitable food record Fallback and
                          exists                  uncertainty

  F19                     Protein available,      Nutrient-level data
                          vitamin C missing       coverage

  F20                     Conflicting database    Source selection
                          values                  

  F21                     User rejects a          Correction and
                          suggested match         alternative selection

  F22                     User uploads a          OCR, ingredient
                          seasoning label         extraction and
                                                  verification
  -----------------------------------------------------------------------

Additional recipe, meal-planning and consumption test cases should be
added as those workflows are designed.

------------------------------------------------------------------------

## 12. Broader MVP capability inventory

This is a grouped scope inventory, not a numbered task tracker.

  -----------------------------------------------------------------------
  Product area            Capability inventory    Current specification
                                                  state
  ----------------------- ----------------------- -----------------------
  Food management         Search, identify,       Core flow agreed;
                          resolve, customize,     details open
                          review, use and save    
                          foods                   

  Food data               Database sources,       Principles agreed;
                          provenance, source      source strategy open
                          conflicts, custom       
                          records                 

  Portions                Grams, millilitres,     Open
                          pieces, household       
                          measures and portion    
                          estimation              

  Packaged foods          Label capture, OCR,     Intended capability;
                          barcode lookup and      workflow open
                          verification            

  Recipes                 Create, edit,           Initial flow drafted;
                          calculate, save and     key decisions open
                          reuse                   

  Recipe variations       Substitutions,          Open
                          alternatives and        
                          version history         

  Nutrition engine        Food, ingredient,       Principles agreed;
                          recipe and serving      detailed rules open
                          calculations            

  Meal planning           Daily/weekly plans,     Scope direction;
                          meal slots, live        workflow open
                          nutrition feedback      

  Meal rotation           Reusable plans and      Scope direction;
                          variations              workflow open

  Consumption             Actual, partial,        Scope direction;
                          skipped and unplanned   workflow open
                          food logging            

  Planned vs actual       Daily/weekly            Scope direction;
                          comparisons             workflow open

  Nutrition insights      Gaps, excesses, trends  Broad scope only
                          and data coverage       

  Dashboard/navigation    Main overview and       Deferred in current
                          navigation              discussion

  Nutrition targets       Target definitions and  Deferred in current
                          evaluation              discussion

  AI assistance           Interpretation,         Core direction agreed;
                          matching, recipe        implementation details
                          parsing, estimation and open
                          explanations            

  AI quality controls     Validation, evaluation, Principles partly
                          audit trail and         agreed; thresholds open
                          confidence calibration  

  Data management         History, backups,       Open
                          deletion and export     

  Privacy and security    Data handling,          Open
                          permissions and         
                          protection              

  Technical foundation    Architecture, APIs,     Not finalized
                          database, migrations    
                          and testing             
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 13. Technical direction --- not locked

The earlier planning baseline suggested the following stack. These are
proposals only; no final technology decision has been recorded.

  Layer                      Earlier proposal
  -------------------------- --------------------------
  Frontend                   Next.js + TypeScript
  UI                         Tailwind CSS + shadcn/ui
  Client data                TanStack Query
  Backend                    FastAPI + Python
  Validation                 Pydantic
  ORM                        SQLAlchemy
  Migrations                 Alembic
  Initial database           SQLite
  Possible future database   PostgreSQL
  Architecture               Modular monolith

The current product-design work should finish the workflows and clarify
requirements before these choices are finalized. Microservices are not
needed merely for the sake of architecture; the earlier direction was to
begin with a modular monolith.

------------------------------------------------------------------------

## 14. Open Decisions Register

These are the decisions still requiring discussion. They are grouped by
area rather than assigned a changing sequence of tracker numbers.

### Food management

  -----------------------------------------------------------------------
  Open item                           What needs to be decided
  ----------------------------------- -----------------------------------
  Food identity and variant schema    Exact distinction between base
                                      foods, variants, preparation states
                                      and nutrition profiles

  Food database strategy              Which sources to use, priority
                                      rules, licensing and update
                                      strategy

  Match resolution                    How exact, close and conflicting
                                      matches are ranked and presented

  Portion handling                    Grams, millilitres, pieces,
                                      household measures and conversions

  Quantity interpretation             How quantities are inferred from
                                      phrases such as "two slices" or
                                      "one medium banana"

  Custom foods                        Creation, editing, reuse, duplicate
                                      handling and retention

  Variant persistence                 Whether recent variants are
                                      retained automatically and how
                                      users explicitly save reusable
                                      variants

  Estimate presentation               Single estimate, estimate plus
                                      range, or adaptive presentation
                                      based on evidence quality

  Reference-profile control           Whether users can switch between
                                      the reference profile and adjusted
                                      estimate
  -----------------------------------------------------------------------

### Recipe management

  -----------------------------------------------------------------------
  Open item                           What needs to be decided
  ----------------------------------- -----------------------------------
  Recipe boundary                     Whether simple combinations and
                                      basic preparations use the same
                                      recipe system as complex dishes

  Creation routes                     Confirm manual, AI-described and
                                      imported/pasted recipe entry

  Complexity-adaptive UI              How to avoid unnecessary cooking
                                      fields for simple combinations

  Ingredient quantities               How to capture, infer and edit
                                      ingredient quantities

  Cooking details                     Which ingredient and recipe
                                      preparation details are necessary

  Yield                               How final cooked weight is captured
                                      or estimated

  Servings                            How serving count, serving weight
                                      and actual logged quantity interact

  Variations and substitutions        How alternatives and recipe changes
                                      are represented

  Versioning                          How original recipes and historical
                                      nutrition calculations are
                                      preserved
  -----------------------------------------------------------------------

### Meal planning and consumption

  -----------------------------------------------------------------------
  Open item                           What needs to be decided
  ----------------------------------- -----------------------------------
  Planner structure                   Calendar, days, meal slots and
                                      navigation

  Adding items                        How foods and recipes are added,
                                      copied, moved or removed

  Live nutrition feedback             Where and how nutrition updates
                                      appear while planning

  Reusable plans                      Templates, rotation and recurring
                                      meal structures

  Actual logging                      How planned meals become actual
                                      consumption without assuming they
                                      were eaten

  Partial consumption                 How users record part of a serving
                                      or a custom quantity

  Unplanned food                      How food eaten outside a plan is
                                      added

  Corrections                         How past consumption entries are
                                      edited and recalculated

  Planned vs actual                   Comparison periods, metrics and
                                      visualization
  -----------------------------------------------------------------------

### Nutrition engine and AI

  -----------------------------------------------------------------------
  Open item                           What needs to be decided
  ----------------------------------- -----------------------------------
  Nutrient taxonomy                   Which nutrients and categories are
                                      displayed and prioritized

  Source selection                    How to resolve conflicting database
                                      values

  Cooking calculations                Which yield and retention factors
                                      are supported and how evidence is
                                      stored

  Estimate confidence                 How confidence is derived and
                                      calibrated

  Validation thresholds               Acceptable ranges and consistency
                                      rules

  AI evaluation                       Test datasets, evaluation metrics
                                      and release thresholds

  Audit trail                         What source, model, prompt/method
                                      version and calculation history are
                                      retained
  -----------------------------------------------------------------------

### Product and technical foundation

  -----------------------------------------------------------------------
  Open item                           What needs to be decided
  ----------------------------------- -----------------------------------
  Navigation and dashboard            Main app structure after core
                                      workflows are settled

  Targets                             Target types, ranges, priorities
                                      and evaluation periods

  Data management                     History, backups, export and
                                      deletion

  Privacy/security                    Data minimization, access controls
                                      and retention

  Architecture                        Frontend/backend boundaries and API
                                      design

  Database                            Schema, migrations and persistence
                                      strategy

  Testing                             Unit, integration and end-to-end
                                      testing plan
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 15. Deferred capabilities

These are intentionally not part of the current core workflow-design
sequence:

-   Onboarding and account setup.
-   Profile and preference configuration.
-   Detailed nutrition target setup.
-   Dashboard and final navigation design.
-   AI companion as a broader conversational experience.
-   Fud AI integration.
-   Health Connect and activity data.
-   Broader health features beyond nutrition.

Deferred does not mean permanently excluded. Revisit these after the
four core workflows have been designed sufficiently.

------------------------------------------------------------------------

## 16. Current project position and next steps

### What is currently agreed

-   Nutrition-first product direction and user-friendly design
    principles.
-   Layered conceptual food model.
-   Explicit, defaulted, AI-inferred and unknown attribute states.
-   Distinction between separate food identities and preparation states
    in the examples recorded above.
-   Hybrid ingredient-level and recipe-level cooking model.
-   Evidence-led estimates with transparent uncertainty and an
    insufficient-evidence state.
-   Nutrient-level provenance for sourced, calculated and estimated
    values.
-   Separation of AI interpretation from deterministic nutrition
    resolution and calculation.
-   Reference-food comparison when the exact variant is unavailable.
-   Four food-entry methods converging into one shared resolution
    workflow.
-   Food use and personal-library saving as separate actions.

### What is being worked on now

**Recipe management workflow.**

The next question to resolve is whether simple combinations (for
example, milk + cereal) and basic preparations (for example, boiled
eggs) should use the same recipe system as complex multi-ingredient
dishes.

A recommended direction is one underlying recipe model with an interface
that adapts to complexity. This remains a proposal until explicitly
accepted.

### Recommended discussion sequence

1.  Finish the recipe-management workflow and settle its open decisions.
2.  Design meal planning.
3.  Design actual consumption and tracking.
4.  Design planned-versus-actual feedback.
5.  Return to the food data model, database/source strategy and detailed
    nutrition-engine rules with the workflows as context.
6.  Finalize dashboard, targets, architecture and implementation
    planning.

**Working rule:** We continue refining the product in conversation, and
this document is updated whenever a decision is made. It is the durable
record; chat messages and temporary trackers are not separate sources of
truth.
