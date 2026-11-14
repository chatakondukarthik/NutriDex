# NutriPlan — Data Model

**Status:** S1 implemented; recipe and plan entities are designed, not built.

---

## 1. Implemented (S1)

```
entries
  id          TEXT PRIMARY KEY
  food_id     TEXT NOT NULL
  grams       REAL NOT NULL     -- resolved weight, stored, never re-derived
  amount      REAL NOT NULL     -- what the user typed
  unit        TEXT NOT NULL     -- "g" | "ml" | "portion:1 katori"
  day         TEXT NOT NULL     -- YYYY-MM-DD, local calendar day
  created_at  TEXT NOT NULL
```

Two deliberate choices:

- **`grams` is stored.** If the portion table changes later, yesterday's entry
  keeps the weight it was logged with.
- **`amount` and `unit` are stored too.** The user's original input is evidence;
  re-deriving it from grams loses intent.

Foods are read-only seed data in `src/lib/data/foods.ts` for now. They move into
the database when the importer lands.

---

## 2. Designed, not built

### 2.1 Nutrients and foods (D-025)

```
nutrients
  code        TEXT PRIMARY KEY   -- INFOODS tagname, e.g. "FE"
  label       TEXT
  unit        TEXT
  "group"     TEXT

food_sources
  id          TEXT PRIMARY KEY
  name        TEXT
  version     TEXT
  licence     TEXT
  attribution TEXT

foods
  id           TEXT PRIMARY KEY
  name         TEXT
  category     TEXT
  kind         TEXT              -- raw | branded | composite
  state        TEXT              -- raw | cooked
  density_g_ml REAL
  archived_at  TEXT

food_nutrients
  food_id          TEXT
  nutrient_code    TEXT
  amount_per_100g  REAL
  basis            TEXT          -- per_100g | per_serving | per_pack
  status           TEXT          -- known | estimated | unknown
  method           TEXT
  source_id        TEXT
  source_food_code TEXT
  PRIMARY KEY (food_id, nutrient_code)

food_portions
  id        TEXT PRIMARY KEY
  food_id   TEXT
  label     TEXT                 -- "1 katori"
  grams     REAL
  source    TEXT

yield_factors
  food_id   TEXT
  operation TEXT
  yield_pct REAL
  source    TEXT
```

Rule: no food record is overwritten. A source refresh creates a new snapshot
(`food_sources.version`), and existing recipe versions keep pointing at what
they used.

### 2.2 Recipes (D-018, D-021, D-023, D-024)

```
recipes
  id                TEXT PRIMARY KEY
  kind              TEXT      -- dish | component
  parent_recipe_id  TEXT      -- variant fork
  name              TEXT
  current_version_id TEXT

recipe_versions
  id                       TEXT PRIMARY KEY
  recipe_id                TEXT
  version_no               INTEGER
  instructions             TEXT
  servings                 REAL
  yield_g                  REAL
  computed_snapshot        JSON   -- totals, coverage, per-block subtotals
  calculation_version      TEXT
  created_at               TEXT

components                    -- a block inside a recipe version
  id            TEXT PRIMARY KEY
  recipe_version_id TEXT
  position      INTEGER
  name          TEXT
  operation     TEXT          -- grate | dice | boil | fry | mix | assemble
  output_yield_g REAL

component_inputs
  id              TEXT PRIMARY KEY
  component_id    TEXT
  food_id         TEXT        -- XOR with recipe_version_id
  recipe_version_id TEXT      -- a pinned component reference
  quantity_g      REAL
  preparation     TEXT        -- raw | boiled | grated ...
```

The `food_id` XOR `recipe_version_id` mirrors the pattern the blueprint already
uses for planned meal items: one row is either a food or a pinned recipe
version, never both.

**Cycles are impossible by construction.** A version can only reference
versions that already exist, and versions are immutable. No cycle detection
code is needed.

### 2.3 Plans

```
plans
  id         TEXT PRIMARY KEY
  user_id    TEXT
  starts_on  TEXT

plan_entries
  id               TEXT PRIMARY KEY
  plan_id          TEXT
  day              TEXT
  slot             TEXT      -- breakfast | lunch | dinner | snack
  position         INTEGER
  food_id          TEXT      -- XOR
  recipe_version_id TEXT     -- XOR
  servings         REAL

targets
  id          TEXT PRIMARY KEY
  user_id     TEXT
  nutrient    TEXT
  direction   TEXT   -- min | max
  value       REAL
  period      TEXT   -- day | week
```

Plans reference **recipe versions**, not recipes. That is what makes statement 4
of the definition of done true: a saved plan does not change when a food record
is corrected.

---

## 3. Rules that apply everywhere

1. **Per 100 g is the only internal basis.** Convert at the boundary.
2. **`null` is unknown.** Never zero.
3. **Every value carries a source.** No unattributed numbers.
4. **Snapshots are immutable.** Editing produces a new version.
5. **Archive, do not delete,** anything a version references.
6. **Store what the user meant,** not just what it computed.
