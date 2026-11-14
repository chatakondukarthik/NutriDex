# NutriPlan — Data Model

**Status:** S1 and S2 implemented; plan entities are designed, not built.

---

## 1. Implemented (S1 and S2)

Schema lives in `src/lib/db/client.ts`; queries in `src/lib/db/`.

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

```
recipes
  id                 TEXT PRIMARY KEY
  kind               TEXT NOT NULL DEFAULT 'dish'   -- dish | component
  name               TEXT NOT NULL
  current_version_id TEXT                          -- null only mid-transaction
  created_at         TEXT NOT NULL
  updated_at         TEXT NOT NULL

recipe_versions
  id                  TEXT PRIMARY KEY
  recipe_id           TEXT NOT NULL REFERENCES recipes
  version_no          INTEGER NOT NULL             -- UNIQUE (recipe_id, version_no)
  instructions        TEXT NOT NULL DEFAULT ''
  servings            REAL NOT NULL
  yield_g             REAL                          -- final block's measured output
  snapshot            TEXT NOT NULL                 -- computed RecipeResult, JSON
  calculation_version TEXT NOT NULL
  created_at          TEXT NOT NULL

components                                        -- a block inside a version
  id                TEXT PRIMARY KEY
  recipe_version_id TEXT NOT NULL REFERENCES recipe_versions
  position          INTEGER NOT NULL
  name              TEXT NOT NULL
  operation         TEXT                          -- label only (D-022)
  output_g          REAL                          -- measured mass after the operation

component_inputs
  id           TEXT PRIMARY KEY
  component_id TEXT NOT NULL REFERENCES components
  position     INTEGER NOT NULL
  food_id      TEXT NOT NULL
  grams        REAL NOT NULL                      -- resolved weight
  amount       REAL NOT NULL                      -- what the user typed
  unit         TEXT NOT NULL                      -- incl. "portion:1 pinch"
  preparation  TEXT
  note         TEXT
```

Deliberate choices:

- **`grams` is stored on every line.** If the portion table changes later,
  yesterday's entry and yesterday's recipe version keep the weight they were
  saved with.
- **`amount` and `unit` are stored too.** The user's original input is evidence;
  re-deriving it from grams loses intent.
- **`snapshot` is stored on the version.** Reading a recipe never recomputes it,
  so a data correction cannot silently change a saved recipe (D-024).
- **The name lives on `recipes`, not the version.** Renaming updates the recipe;
  the version snapshot keeps the numbers it was saved with.
- **`kind = 'component'` exists in the schema but no UI creates one yet** (D-023
  is designed, not built).

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

### 2.2 Recipe deltas not yet built (D-018, D-023)

```
recipes
  parent_recipe_id  TEXT      -- variant fork; absent today

component_inputs
  recipe_version_id TEXT      -- a pinned component reference; XOR with food_id
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
