# NutriPlan — Data Model

**Status:** S1–S3 implemented; the food importer and AI layers are designed, not built.

---

## 1. Implemented (S1–S3)

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
  label               TEXT                          -- optional human name ("less salt")
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
- **A version can carry a label.** It is optional and free text ("less salt",
  "trial 2"), stored with the version so the palette can offer *that* version by
  name. It is not a unique key and never replaces `version_no`.
- **`kind = 'component'` exists in the schema but no UI creates one yet** (D-023
  is designed, not built).

```
profile                                  -- one row, id = 'local'
  id               TEXT PRIMARY KEY
  sex              TEXT NOT NULL         -- female | male
  age_years        REAL NOT NULL
  height_cm        REAL NOT NULL
  weight_kg        REAL NOT NULL
  activity         TEXT NOT NULL         -- sedentary | light | moderate | active
  goal             TEXT NOT NULL         -- lose | maintain | gain
  body_fat_percent REAL                  -- optional; switches BMR to Katch–McArdle
  pace             TEXT NOT NULL DEFAULT 'steady'   -- gentle | steady | fast
  target_weight_kg REAL                  -- optional; projection only
  updated_at       TEXT NOT NULL

plans
  id         TEXT PRIMARY KEY
  starts_on  TEXT NOT NULL UNIQUE        -- Monday, YYYY-MM-DD
  created_at TEXT NOT NULL

plan_entries
  id                TEXT PRIMARY KEY
  plan_id           TEXT NOT NULL REFERENCES plans (id)
  day               TEXT NOT NULL        -- YYYY-MM-DD, inside the week
  slot              TEXT NOT NULL        -- breakfast | lunch | dinner | snack
  position          INTEGER NOT NULL
  food_id           TEXT                 -- XOR
  recipe_version_id TEXT REFERENCES recipe_versions (id)   -- XOR
  grams             REAL                 -- food quantity
  amount            REAL                 -- what the user chose, when not grams
  unit              TEXT                 -- incl. "portion:1 katori"
  servings          REAL                 -- recipe quantity
  created_at        TEXT NOT NULL
  CHECK ((food_id IS NOT NULL) <> (recipe_version_id IS NOT NULL))
```

Deliberate choices:

- **A plan is a week.** `starts_on` is unique, so there is exactly one plan per
  week; the week is created on first write, not on first view.
- **An entry is a food XOR a recipe version.** The `CHECK` makes the invalid
  state impossible to store, not merely unlikely to be written.
- **`recipe_version_id`, never `recipe_id`.** This is the pin that keeps a
  planned week stable when a recipe is edited (D-024).
- **Targets are not stored.** They are derived from `profile` on read, so there
  is no 18-row target set to keep in sync (D-030).
- **Pace is an enum, not a kg/week column.** The rate is a share of body weight,
  so it stays correct as the weight changes instead of going stale (D-031).
- **Body fat and target weight are nullable.** Body fat upgrades the energy
  equation; target weight only feeds a projection. Neither is required to use
  the app, so neither is a `NOT NULL` the form has to fake.

Schema changes are additive and idempotent: `migrate()` reads `PRAGMA
table_info` and adds any missing column, so an existing local database upgrades
in place instead of being dropped. Fresh databases get the full schema above.

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

### 2.3 Target overrides

Not built. The derived targets are enough for S3; a person who needs a number
their profile cannot express needs an override row:

```
target_overrides
  user_id    TEXT
  nutrient   TEXT
  direction  TEXT      -- min | max
  value      REAL
  period     TEXT      -- day
  reason     TEXT      -- why the derived value was not used
  PRIMARY KEY (user_id, nutrient)
```

The override is additive, not a replacement for `targetsFor()`: the derived
value stays the default, and the override carries its own reason. Q-003 is
open, so the shape of a range-based target is not settled yet either.

---

## 3. Rules that apply everywhere

1. **Per 100 g is the only internal basis.** Convert at the boundary.
2. **`null` is unknown.** Never zero.
3. **Every value carries a source.** No unattributed numbers.
4. **Snapshots are immutable.** Editing produces a new version.
5. **Archive, do not delete,** anything a version references.
6. **Store what the user meant,** not just what it computed.
7. **One connection per process, with a busy timeout.** The dev server and the
   parallel build workers each open the same SQLite file, so the connection sets
   `busy_timeout` before any DDL. Without it, two workers starting at once fail
   with `database is locked`.
