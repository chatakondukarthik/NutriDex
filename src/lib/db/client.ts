import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { dataFile, ensureDataDir } from "@/lib/data-dir";
import { ensurePrivateDir, restrictFile } from "@/lib/security/private-files";
import { SEED_FACTORS } from "@/lib/nutrition/retention-seed";

/**
 * Local persistence.
 *
 * Node 26 ships SQLite, so there is no native dependency and no service
 * to run. This is deliberately a thin layer: when the app moves to
 * Postgres for deployment, only this file and the queries change.
 */
const globalForDb = globalThis as unknown as { __nutriplanDb?: DatabaseSync };

function resolveDbPath(): string {
  // NUTRIPLAN_DB_PATH exists so tests can point at a throwaway file.
  // Otherwise the file lives under NUTRIPLAN_DATA_DIR (or ./data).
  return process.env.NUTRIPLAN_DB_PATH ?? dataFile("nutriplan.sqlite");
}

const SCHEMA = `
  -- Build workers and the dev server each open the file. Without a busy
  -- timeout, two of them running DDL at the same moment fail with
  -- "database is locked" instead of waiting a few milliseconds.
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- One installation is one household (D-051). The row exists so an archive
  -- can name its origin and so a future import can tell two households apart.
  CREATE TABLE IF NOT EXISTS households (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT 'Household',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- People are convenience scopes, never a privacy boundary. The body profile
  -- lives in the profile table keyed by this id; a person can exist without one.
  CREATE TABLE IF NOT EXISTS people (
    id           TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households (id),
    display_name TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    archived_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS entries (
    id                TEXT PRIMARY KEY,
    person_id         TEXT NOT NULL REFERENCES people (id),
    food_id           TEXT,
    -- A diary entry is a food OR a pinned recipe version, never both.
    recipe_version_id TEXT REFERENCES recipe_versions (id),
    grams             REAL NOT NULL,
    amount            REAL NOT NULL,
    unit              TEXT NOT NULL,
    day               TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    CHECK ((food_id IS NOT NULL) <> (recipe_version_id IS NOT NULL))
  );

  -- The old entries_day_idx is created for pre-household databases by
  -- SCHEMA and replaced by a person-aware index during the household
  -- migration. It is not declared here: person_id does not exist until then.


  CREATE TABLE IF NOT EXISTS recipes (
    id                 TEXT PRIMARY KEY,
    kind               TEXT NOT NULL DEFAULT 'dish',
    name               TEXT NOT NULL,
    current_version_id TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    -- Set when archived. Archived recipes are hidden but keep their
    -- versions because plans pin them.
    archived_at        TEXT
  );

  CREATE TABLE IF NOT EXISTS recipe_versions (
    id                  TEXT PRIMARY KEY,
    recipe_id           TEXT NOT NULL REFERENCES recipes (id),
    version_no          INTEGER NOT NULL,
    instructions        TEXT NOT NULL DEFAULT '',
    servings            REAL NOT NULL,
    yield_g             REAL,
    snapshot            TEXT NOT NULL,
    calculation_version TEXT NOT NULL,
    -- Optional human name for the version ("less salt", "trial 2").
    label               TEXT,
    created_at          TEXT NOT NULL,
    UNIQUE (recipe_id, version_no)
  );

  CREATE INDEX IF NOT EXISTS recipe_versions_recipe_idx
    ON recipe_versions (recipe_id, version_no DESC);

  CREATE TABLE IF NOT EXISTS components (
    id                TEXT PRIMARY KEY,
    recipe_version_id TEXT NOT NULL REFERENCES recipe_versions (id),
    position          INTEGER NOT NULL,
    name              TEXT NOT NULL,
    operation         TEXT,
    output_g          REAL
  );

  CREATE INDEX IF NOT EXISTS components_version_idx
    ON components (recipe_version_id, position);

  CREATE TABLE IF NOT EXISTS component_inputs (
    id            TEXT PRIMARY KEY,
    component_id  TEXT NOT NULL REFERENCES components (id),
    position      INTEGER NOT NULL,
    food_id       TEXT NOT NULL,
    grams         REAL NOT NULL,
    amount        REAL NOT NULL,
    unit          TEXT NOT NULL,
    preparation   TEXT,
    note          TEXT
  );

  CREATE INDEX IF NOT EXISTS component_inputs_component_idx
    ON component_inputs (component_id, position);

  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Archive and identity metadata, one row per key. This is *not* user
  -- content: created_at and account_id are copied into the archive
  -- manifest, not into the NDJSON tables, and an import never overwrites
  -- them. account_id is the only link to an online identity, and it is
  -- opaque (never an email or a name).
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profile (
    id               TEXT PRIMARY KEY REFERENCES people (id),
    sex              TEXT NOT NULL,
    age_years        REAL NOT NULL,
    height_cm        REAL NOT NULL,
    weight_kg        REAL NOT NULL,
    activity         TEXT NOT NULL,
    goal             TEXT NOT NULL,
    -- Optional. Switches the energy equation to Katch–McArdle when set.
    body_fat_percent REAL,
    -- gentle | steady | fast. Stored as a pace, not a kg figure, so the
    -- rate follows the current weight instead of going stale.
    pace             TEXT NOT NULL DEFAULT 'steady',
    -- Optional. Used for the time-to-goal projection only.
    target_weight_kg REAL,
    -- Optional manual energy target. The profile form has always sent it;
    -- before household mode the read/write path silently dropped it.
    target_energy_kcal REAL,
    updated_at       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plans (
    id         TEXT PRIMARY KEY,
    person_id  TEXT NOT NULL REFERENCES people (id),
    starts_on  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (person_id, starts_on)
  );

  -- Per-person settings. target_rules moved here from app_settings so two
  -- people can keep different thresholds. ai_master_prompt stays household.
  CREATE TABLE IF NOT EXISTS person_settings (
    person_id  TEXT NOT NULL REFERENCES people (id),
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (person_id, key)
  );

  -- Internal migration marker. Never exported and never writable by import.
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plan_entries (
    id                TEXT PRIMARY KEY,
    plan_id           TEXT NOT NULL REFERENCES plans (id),
    day               TEXT NOT NULL,
    slot              TEXT NOT NULL,
    position          INTEGER NOT NULL,
    -- A plan entry is a food OR a pinned recipe version, never both.
    food_id           TEXT,
    recipe_version_id TEXT REFERENCES recipe_versions (id),
    grams             REAL,
    amount            REAL,
    unit              TEXT,
    servings          REAL,
    created_at        TEXT NOT NULL,
    CHECK ((food_id IS NOT NULL) <> (recipe_version_id IS NOT NULL))
  );

  CREATE INDEX IF NOT EXISTS plan_entries_plan_idx
    ON plan_entries (plan_id, day, slot, position);

  -- Per-nutrient retention factors for cooking operations (S10, D-041).
  -- Seed values are USDA Table of Nutrient Retention Factors (Release 6,
  -- public domain), unverified fixtures pending review — the same status as
  -- the seed foods. Factor = fraction of the nutrient retained (0..2).
  CREATE TABLE IF NOT EXISTS retention_factors (
    id         TEXT PRIMARY KEY,
    operation  TEXT NOT NULL,
    qualifier  TEXT,                     -- e.g. 'drained' | 'undrained'
    nutrient   TEXT NOT NULL,
    factor     REAL NOT NULL,
    source     TEXT NOT NULL DEFAULT 'usda-r6',
    notes      TEXT,
    -- 'seed' rows ship with the app and are re-created on boot; only
    -- 'user' rows are user content and travel in an export.
    origin     TEXT NOT NULL DEFAULT 'user'
  );
  CREATE INDEX IF NOT EXISTS retention_factors_lookup_idx
    ON retention_factors (operation, nutrient);

  -- Cache of LLM nutrient-delta estimates, keyed by the operation + input mix.
  CREATE TABLE IF NOT EXISTS estimate_cache (
    cache_key  TEXT PRIMARY KEY,
    operation  TEXT NOT NULL,
    payload    TEXT NOT NULL,            -- JSON: per-nutrient factors + reasons
    created_at TEXT NOT NULL
  );

  -- Foods the user captured (S6). Seed foods stay in src/lib/data/foods.ts
  -- until the importer lands; these tables hold everything the user added.
  -- A captured food is referenced by the same columns as a seed food, so a
  -- recipe or plan cannot tell the difference.
  CREATE TABLE IF NOT EXISTS captured_foods (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    aliases           TEXT NOT NULL DEFAULT '[]',
    category          TEXT,
    kind              TEXT NOT NULL DEFAULT 'provisional',
    state             TEXT NOT NULL DEFAULT 'raw',
    density_g_ml      REAL,
    basis             TEXT,
    serving_size_g    REAL,
    servings_per_pack REAL,
    source            TEXT NOT NULL DEFAULT 'manual',
    source_code       TEXT,
    image_path        TEXT,
    confidence        REAL,
    -- Provenance detail: for USDA rows, the dataType the food came from
    -- (foundation | sr_legacy | fndds | branded); for imports, the
    -- publication date the value set was current on.
    source_kind      TEXT,
    source_published TEXT,
    created_by        TEXT NOT NULL DEFAULT 'local',
    created_at        TEXT NOT NULL,
    archived_at       TEXT
  );

  CREATE INDEX IF NOT EXISTS captured_foods_name_idx
    ON captured_foods (name);

  CREATE TABLE IF NOT EXISTS ai_calls (
    id                TEXT PRIMARY KEY,
    provider          TEXT NOT NULL,
    model             TEXT NOT NULL,
    capability        TEXT NOT NULL,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    latency_ms        INTEGER,
    status            TEXT NOT NULL,
    error             TEXT,
    created_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS captured_food_nutrients (
    food_id   TEXT NOT NULL REFERENCES captured_foods (id),
    nutrient  TEXT NOT NULL,
    amount    REAL,
    status    TEXT NOT NULL DEFAULT 'unknown',
    method    TEXT,
    PRIMARY KEY (food_id, nutrient)
  );

  CREATE TABLE IF NOT EXISTS captured_food_portions (
    id      TEXT PRIMARY KEY,
    food_id TEXT NOT NULL REFERENCES captured_foods (id),
    label   TEXT NOT NULL,
    grams   REAL NOT NULL,
    source  TEXT
  );

  -- User-pinned default amount/unit for a food when it is added
  -- anywhere. Separate from captured_foods so pins work for seed foods
  -- too (they live in code, not in a table). Pins are per person (D-051).
  CREATE TABLE IF NOT EXISTS food_default_amounts (
    person_id  TEXT NOT NULL REFERENCES people (id),
    food_id    TEXT NOT NULL,
    amount     REAL NOT NULL,
    unit       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (person_id, food_id)
  );
`;

function createDb(): DatabaseSync {
  const dbPath = resolveDbPath();
  const dataRoot = ensureDataDir();
  // Tighten the DB's parent only when it is the app's own data directory.
  // `NUTRIPLAN_DB_PATH` may point at a shared or unrelated directory (tests,
  // a mounted volume, `:memory:`); chmod'ing that to 0700 would break other
  // services. The 0600 file mode below is the actual protection.
  const parent = path.dirname(path.resolve(dbPath));
  if (parent === path.resolve(dataRoot)) {
    ensurePrivateDir(parent);
  } else {
    // Create a missing parent for an explicit `NUTRIPLAN_DB_PATH` (a fresh
    // mounted volume, a CI temp dir), but do not chmod it: it may be shared.
    mkdirSync(parent, { recursive: true });
  }

  const database = new DatabaseSync(dbPath);
  database.exec(SCHEMA);
  migrate(database, dbPath);
  // Boot invariant: one household and at least one person. A fresh database
  // gets both here; an existing one is repaired if a repair left the roster
  // empty. Person-scoped code can then assume a person exists.
  ensureHousehold(database);
  recordCreatedAt(database);
  seedRetentionFactors(database);
  restrictDbFiles(dbPath);

  return database;
}

/**
 * Record when this installation's database was created, once.
 *
 * The archive manifest reports it. Writing it at boot rather than at export
 * keeps `GET /api/export` a pure read.
 */
function recordCreatedAt(database: DatabaseSync): void {
  database
    .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('created_at', ?)")
    .run(new Date().toISOString());
}

/**
 * The main file and its WAL sidecars are created by SQLite, not by us, so
 * they inherit the umask. Tighten them after the first write has created
 * them; `SCHEMA` has already put the database in WAL mode, so both sidecars
 * exist by this point. Recreated sidecars inherit the database's mode.
 */
function restrictDbFiles(dbPath: string): void {
  restrictFile(dbPath);
  restrictFile(`${dbPath}-wal`);
  restrictFile(`${dbPath}-shm`);
}

/**
 * Add columns that were introduced after the first schema.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already
 * exists, so a new column needs an explicit `ALTER TABLE`. Every column
 * is additive and nullable (or has a default). The one destructive change —
 * the `entries` rebuild — runs in a single transaction and is recoverable
 * if an older boot was interrupted.
 */
function migrate(database: DatabaseSync, dbPath: string): void {
  const householdPending = !hasHouseholdMigration(database);

  if (householdPending) {
    // Refuse an in-between state before touching anything. A build that
    // crashed outside a transaction could have left person columns without
    // the marker; guessing which copy is authoritative would risk the diary.
    assertHouseholdStateIsMigratable(database);
    if (hasUserData(database)) snapshotBeforeHousehold(database, dbPath);
  }

  addColumn(database, "profile", "body_fat_percent", "REAL");
  addColumn(database, "profile", "pace", "TEXT NOT NULL DEFAULT 'steady'");
  addColumn(database, "profile", "target_weight_kg", "REAL");
  addColumn(database, "recipe_versions", "label", "TEXT");
  addColumn(database, "profile", "target_energy_kcal", "REAL");
  addColumn(database, "recipes", "archived_at", "TEXT");
  addColumn(database, "captured_food_nutrients", "note", "TEXT");
  // Rows seeded before `origin` existed are all fixtures: the seeder was the
  // only writer to this table. Mark them when the column is first added, and
  // let `seedRetentionFactors` reconcile the rest on every boot.
  if (addColumn(database, "retention_factors", "origin", "TEXT NOT NULL DEFAULT 'user'")) {
    database.exec("UPDATE retention_factors SET origin = 'seed'");
  }
  rebuildEntriesTable(database);

  if (householdPending) migrateHousehold(database);
}

/** Version 1 of the household schema in `schema_migrations`. */
const HOUSEHOLD_MIGRATION_VERSION = 1;

function hasHouseholdMigration(database: DatabaseSync): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 AS present FROM schema_migrations WHERE version = ?")
      .get(HOUSEHOLD_MIGRATION_VERSION),
  );
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function tableColumns(database: DatabaseSync, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>
  ).map((column) => column.name);
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return tableColumns(database, table).includes(column);
}

/**
 * Installations created before provenance detail shipped lack the two
 * columns; both are nullable and additive-only. Fresh installs get them
 * from SCHEMA; this is the upgrade path for everyone else.
 */
function ensureCapturedFoodsColumns(database: DatabaseSync): void {
  if (!tableExists(database, "captured_foods")) return;
  if (!hasColumn(database, "captured_foods", "source_kind")) {
    database.exec("ALTER TABLE captured_foods ADD COLUMN source_kind TEXT");
  }
  if (!hasColumn(database, "captured_foods", "source_published")) {
    database.exec("ALTER TABLE captured_foods ADD COLUMN source_published TEXT");
  }
}

function countRows(database: DatabaseSync, table: string): number {
  if (!tableExists(database, table)) return 0;
  return (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number })
    .n;
}

/**
 * Is there anything in this database a migration could lose?
 *
 * Used only to decide whether the pre-household snapshot is worth taking. A
 * fresh install has no user rows, so it does not get a snapshot file beside
 * its brand-new database.
 */
function hasUserData(database: DatabaseSync): boolean {
  const tables = [
    "profile",
    "entries",
    "entries_v1",
    "plans",
    "plan_entries",
    "recipes",
    "recipe_versions",
    "components",
    "component_inputs",
    "captured_foods",
    "captured_food_nutrients",
    "captured_food_portions",
    "food_default_amounts",
    "app_settings",
  ];
  if (tables.some((table) => countRows(database, table) > 0)) return true;

  if (
    hasColumn(database, "retention_factors", "origin") &&
    database
      .prepare("SELECT 1 AS present FROM retention_factors WHERE origin = 'user' LIMIT 1")
      .get()
  ) {
    return true;
  }

  return false;
}

/**
 * Refuse a database that already has household artefacts but no marker.
 *
 * The migration is one transaction, so SQLite rolls all of it back on a
 * crash. Anything else means an older build wrote a partial shape; picking a
 * side automatically could drop rows, so the operator restores the snapshot.
 */
function assertHouseholdStateIsMigratable(database: DatabaseSync): void {
  if (!hasUserData(database)) return;

  const partial =
    countRows(database, "households") > 0 ||
    countRows(database, "people") > 0 ||
    countRows(database, "person_settings") > 0 ||
    (hasColumn(database, "entries", "person_id") && countRows(database, "entries") > 0) ||
    (hasColumn(database, "plans", "person_id") && countRows(database, "plans") > 0) ||
    (hasColumn(database, "food_default_amounts", "person_id") &&
      countRows(database, "food_default_amounts") > 0);

  if (partial) {
    throw new Error(
      "Database migration is ambiguous: household tables or person columns exist " +
        "but the household migration marker is missing. Restore the " +
        "pre-household snapshot beside the database file, or inspect the database " +
        "before starting.",
    );
  }
}

/**
 * Copy the database beside itself before the destructive part of the
 * household migration. `VACUUM INTO` is the only SQLite-supported way to get
 * a transactionally consistent snapshot of a live database, and it works in
 * WAL mode. The snapshot is kept on success and failure; it is the rollback
 * path, because the rebuilt tables are not individually reversible in place.
 */
function snapshotBeforeHousehold(database: DatabaseSync, dbPath: string): string | null {
  if (
    dbPath === ":memory:" ||
    dbPath.startsWith("file::memory:") ||
    dbPath.includes("mode=memory")
  ) {
    return null;
  }

  const dir = path.dirname(path.resolve(dbPath));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  let target = path.join(dir, `${path.basename(dbPath)}.pre-household-${stamp}.sqlite`);
  let suffix = 1;
  while (existsSync(target)) {
    target = path.join(
      dir,
      `${path.basename(dbPath)}.pre-household-${stamp}-${suffix}.sqlite`,
    );
    suffix += 1;
  }

  // The path is local and generated here; the only SQL-literal hazard is a
  // quote in the directory name, which is escaped rather than trusted.
  database.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  restrictFile(target);
  return target;
}

/**
 * One-time household migration (D-051).
 *
 * Everything is guarded by the live schema, so this is safe to call on a
 * fresh database (the tables already have the new shape) and on a legacy one
 * (the tables are rebuilt). The roster, profile key and target rules move
 * together; the marker is written last.
 */
function migrateHousehold(database: DatabaseSync): void {
  if (hasHouseholdMigration(database)) return;

  const now = new Date().toISOString();

  // Foreign keys must be off before BEGIN: the plans rebuild drops a table
  // that plan_entries references, which is only legal while enforcement is
  // suspended. The final foreign_key_check proves the result.
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const household = database
        .prepare("SELECT id FROM households ORDER BY created_at ASC, rowid ASC LIMIT 1")
        .get() as unknown as { id: string } | undefined;
      const householdId = household?.id ?? randomUUID();
      if (!household) {
        database
          .prepare(
            `INSERT INTO households (id, name, created_at, updated_at)
             VALUES (?, 'Household', ?, ?)`,
          )
          .run(householdId, now, now);
      }

      const existingPerson = database
        .prepare("SELECT id FROM people ORDER BY created_at ASC, rowid ASC LIMIT 1")
        .get() as unknown as { id: string } | undefined;
      const personId = existingPerson?.id ?? randomUUID();
      if (!existingPerson) {
        database
          .prepare(
            `INSERT INTO people (id, household_id, display_name, created_at)
             VALUES (?, ?, 'Me', ?)`,
          )
          .run(personId, householdId, now);
      }

      // The old profile row was keyed by 'local'. Re-key it to the person so
      // the body data survives the migration.
      const profile = database
        .prepare("SELECT id FROM profile ORDER BY rowid ASC LIMIT 1")
        .get() as unknown as { id: string } | undefined;
      if (profile && profile.id !== personId) {
        const conflict = database
          .prepare("SELECT 1 AS present FROM profile WHERE id = ?")
          .get(personId);
        if (conflict) {
          throw new Error(
            "Household migration found two profile rows for the same person. " +
              "Restore the pre-household snapshot and inspect the database.",
          );
        }
        database.prepare("UPDATE profile SET id = ? WHERE id = ?").run(personId, profile.id);
      }

      // target_rules was the one app_setting that is genuinely personal.
      const rules = database
        .prepare("SELECT value FROM app_settings WHERE key = 'target_rules'")
        .get() as unknown as { value: string } | undefined;
      if (rules) {
        database
          .prepare(
            `INSERT INTO person_settings (person_id, key, value, updated_at)
             VALUES (?, 'target_rules', ?, ?)
             ON CONFLICT (person_id, key) DO NOTHING`,
          )
          .run(personId, rules.value, now);
        database.prepare("DELETE FROM app_settings WHERE key = 'target_rules'").run();
      }

      if (!hasColumn(database, "entries", "person_id")) {
        rebuildEntriesForHousehold(database, personId);
      }
      if (!hasColumn(database, "plans", "person_id")) {
        rebuildPlansForHousehold(database, personId);
      }
      if (!hasColumn(database, "food_default_amounts", "person_id")) {
        rebuildDefaultAmountsForHousehold(database, personId);
      }
      if (!hasForeignKeyTo(database, "profile", "people")) {
        rebuildProfileForHousehold(database);
      }
      ensureCapturedFoodsColumns(database);

      // Provenance only, never authorization. Every legacy capture was made
      // by the installation's original person.
      database
        .prepare("UPDATE captured_foods SET created_by = ? WHERE created_by = 'local'")
        .run(personId);

      const violations = database.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0) {
        throw new Error(
          `Household migration left ${violations.length} foreign-key violation(s): ` +
            JSON.stringify(violations.slice(0, 3)),
        );
      }

      database
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(HOUSEHOLD_MIGRATION_VERSION, now);
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        /* SQLite may already have rolled back */
      }
      throw error;
    }
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function hasForeignKeyTo(database: DatabaseSync, table: string, parent: string): boolean {
  const rows = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as unknown as Array<{
    table: string;
  }>;
  return rows.some((row) => row.table === parent);
}

function rebuildEntriesForHousehold(database: DatabaseSync, personId: string): void {
  database.exec(`
    CREATE TABLE entries_household (
      id                TEXT PRIMARY KEY,
      person_id         TEXT NOT NULL REFERENCES people (id),
      food_id           TEXT,
      recipe_version_id TEXT REFERENCES recipe_versions (id),
      grams             REAL NOT NULL,
      amount            REAL NOT NULL,
      unit              TEXT NOT NULL,
      day               TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      CHECK ((food_id IS NOT NULL) <> (recipe_version_id IS NOT NULL))
    );
  `);
  database
    .prepare(
      `INSERT INTO entries_household
         (id, person_id, food_id, recipe_version_id, grams, amount, unit, day, created_at)
       SELECT id, ?, food_id, recipe_version_id, grams, amount, unit, day, created_at
       FROM entries`,
    )
    .run(personId);
  database.exec(`
    DROP TABLE entries;
    ALTER TABLE entries_household RENAME TO entries;
    CREATE INDEX IF NOT EXISTS entries_person_day_idx
      ON entries (person_id, day, created_at);
  `);
}

function rebuildPlansForHousehold(database: DatabaseSync, personId: string): void {
  // A plain ALTER TABLE plans RENAME would rewrite plan_entries' foreign key
  // to the old name. Create the replacement under a temporary name, drop the
  // old table, then rename the replacement into place; plan_entries keeps
  // pointing at `plans`.
  database.exec(`
    CREATE TABLE plans_household (
      id         TEXT PRIMARY KEY,
      person_id  TEXT NOT NULL REFERENCES people (id),
      starts_on  TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (person_id, starts_on)
    );
  `);
  database
    .prepare(
      `INSERT INTO plans_household (id, person_id, starts_on, created_at)
       SELECT id, ?, starts_on, created_at FROM plans`,
    )
    .run(personId);
  database.exec(`
    DROP TABLE plans;
    ALTER TABLE plans_household RENAME TO plans;
  `);
}

function rebuildDefaultAmountsForHousehold(database: DatabaseSync, personId: string): void {
  database.exec(`
    CREATE TABLE food_default_amounts_household (
      person_id  TEXT NOT NULL REFERENCES people (id),
      food_id    TEXT NOT NULL,
      amount     REAL NOT NULL,
      unit       TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (person_id, food_id)
    );
  `);
  database
    .prepare(
      `INSERT INTO food_default_amounts_household
         (person_id, food_id, amount, unit, updated_at)
       SELECT ?, food_id, amount, unit, updated_at FROM food_default_amounts`,
    )
    .run(personId);
  database.exec(`
    DROP TABLE food_default_amounts;
    ALTER TABLE food_default_amounts_household RENAME TO food_default_amounts;
  `);
}

const PROFILE_COLUMNS =
  "id, sex, age_years, height_cm, weight_kg, activity, goal, body_fat_percent, " +
  "pace, target_weight_kg, target_energy_kcal, updated_at";

/**
 * Give a legacy profile table the foreign key to `people`. Nothing references
 * profile, so a rebuild is simpler than a parallel `profile_household` table
 * carried forever.
 */
function rebuildProfileForHousehold(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE profile_household (
      id               TEXT PRIMARY KEY REFERENCES people (id),
      sex              TEXT NOT NULL,
      age_years        REAL NOT NULL,
      height_cm        REAL NOT NULL,
      weight_kg        REAL NOT NULL,
      activity         TEXT NOT NULL,
      goal             TEXT NOT NULL,
      body_fat_percent REAL,
      pace             TEXT NOT NULL DEFAULT 'steady',
      target_weight_kg REAL,
      target_energy_kcal REAL,
      updated_at       TEXT NOT NULL
    );
  `);
  database.exec(`
    INSERT INTO profile_household (${PROFILE_COLUMNS})
      SELECT ${PROFILE_COLUMNS} FROM profile;
  `);
  database.exec(`
    DROP TABLE profile;
    ALTER TABLE profile_household RENAME TO profile;
  `);
}

/**
 * Boot invariant: exactly one household row exists and at least one person
 * is in the roster. A fresh install gets a person named "Me"; the first run
 * offers a rename. An existing installation is repaired, never renamed.
 */
export function ensureHousehold(database: DatabaseSync): void {
  const now = new Date().toISOString();

  const household = database
    .prepare("SELECT id FROM households ORDER BY created_at ASC, rowid ASC LIMIT 1")
    .get() as unknown as { id: string } | undefined;
  let householdId = household?.id;
  if (!householdId) {
    householdId = randomUUID();
    database
      .prepare(
        `INSERT INTO households (id, name, created_at, updated_at)
         VALUES (?, 'Household', ?, ?)`,
      )
      .run(householdId, now, now);
  }

  const person = database
    .prepare("SELECT id FROM people ORDER BY created_at ASC, rowid ASC LIMIT 1")
    .get();
  if (!person) {
    database
      .prepare(
        `INSERT INTO people (id, household_id, display_name, created_at)
         VALUES (?, ?, 'Me', ?)`,
      )
      .run(randomUUID(), householdId, now);
  }
}

/**
 * Extend `entries` to also hold at most one recipe-version per row, with the
 * same XOR shape as plan_entries. Done as a rebuild because ALTER can't drop
 * the original NOT NULL on food_id.
 *
 * The rebuild is one `BEGIN IMMEDIATE … COMMIT`: the old code ran the four
 * statements in autocommit, so a crash between RENAME and DROP stranded the
 * user's diary in `entries_v1` while the next boot created an empty `entries`
 * and returned early. A database left in that state by an older build is
 * repaired on the next boot instead of being silently ignored.
 */
function rebuildEntriesTable(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(entries)")
    .all() as unknown as Array<{ name: string }>;
  const hasNewShape = columns.some((column) => column.name === "recipe_version_id");

  const legacy = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries_v1'")
    .get();

  if (legacy) {
    recoverEntriesRebuild(database, hasNewShape);
    return;
  }
  if (hasNewShape) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      ALTER TABLE entries RENAME TO entries_v1;

      -- A diary entry is a food OR a pinned recipe version, never both.
      CREATE TABLE entries (
        id                TEXT PRIMARY KEY,
        food_id           TEXT,
        recipe_version_id TEXT REFERENCES recipe_versions (id),
        grams             REAL NOT NULL,
        amount            REAL NOT NULL,
        unit              TEXT NOT NULL,
        day               TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        CHECK ((food_id IS NOT NULL) <> (recipe_version_id IS NOT NULL))
      );

      INSERT INTO entries (id, food_id, grams, amount, unit, day, created_at)
        SELECT id, food_id, grams, amount, unit, day, created_at FROM entries_v1;

      DROP TABLE entries_v1;

      CREATE INDEX IF NOT EXISTS entries_day_idx ON entries (day, created_at);
    `);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* SQLite may already have rolled back */
    }
    throw error;
  }
}

/**
 * Finish a rebuild that an older, non-transactional boot interrupted.
 *
 * `entries` is the new shape (created by `SCHEMA`) and `entries_v1` is the
 * stranded copy. Two crash points leave a stranded table, and they need
 * different treatment:
 *
 *   - after `CREATE`, before `INSERT`: `entries` holds only rows written
 *     after the crash; the pre-crash diary is still in `entries_v1`;
 *   - after `INSERT`, before `DROP`: every `entries_v1` row is already in
 *     `entries` (same ids). `entries` was then the live table, so it wins
 *     and edits/deletions made since must not be undone.
 *
 * An id present in both means the copy ran, so `entries` is authoritative and
 * the stranded table is a stale snapshot. No overlap means the copy never
 * ran, so the old rows are brought over. Testing for overlap (rather than
 * refusing to start) also avoids resurrecting a row the user deleted after
 * the crash.
 */
function recoverEntriesRebuild(database: DatabaseSync, hasNewShape: boolean): void {
  const count = (table: string) =>
    (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number }).n;

  if (!hasNewShape) {
    // Should not happen: `SCHEMA` always creates the new shape. Refuse rather
    // than drop a table that may hold the only copy of the diary.
    throw new Error(
      "Database migration is ambiguous: entries_v1 exists but entries is not the new shape. " +
        "Back up the data directory and inspect the database before starting.",
    );
  }

  const oldRows = count("entries_v1");
  const overlap =
    oldRows === 0
      ? 0
      : (
          database
            .prepare("SELECT COUNT(*) AS n FROM entries_v1 WHERE id IN (SELECT id FROM entries)")
            .get() as unknown as { n: number }
        ).n;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (oldRows > 0 && overlap === 0) {
      database.exec(`
        INSERT OR IGNORE INTO entries (id, food_id, grams, amount, unit, day, created_at)
          SELECT id, food_id, grams, amount, unit, day, created_at FROM entries_v1;
      `);
    }
    database.exec("DROP TABLE entries_v1");
    // The index followed the RENAME onto entries_v1, so it was dropped with
    // that table. `SCHEMA`'s `CREATE INDEX IF NOT EXISTS` already ran against
    // `entries` before this recovery, so restore it here.
    database.exec("CREATE INDEX IF NOT EXISTS entries_day_idx ON entries (day, created_at)");
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* SQLite may already have rolled back */
    }
    throw error;
  }
}

/**
 * Reconcile the retention-factor seed on every boot.
 *
 * This used to be "insert once if the table is empty". That had two bugs:
 * a user override could never coexist with a repaired seed, and a table
 * that was seeded by an older build (with a different `source` string)
 * looked like user content. Reconciling by content is idempotent: a missing
 * fixture is inserted, a fixture that is present but not marked `seed` is
 * marked, and a genuine override (different factor or source) is left alone.
 */
function seedRetentionFactors(database: DatabaseSync): void {
  const find = database.prepare(
    `SELECT id, origin FROM retention_factors
     WHERE operation = ? AND nutrient = ?
       AND IFNULL(qualifier, '') = IFNULL(?, '')
       AND factor = ? AND source = ?`,
  );
  // A user override for the same key wins over the fixture: do not insert
  // the seed row alongside it, because the engine's lookup is last-row-wins
  // and the fixture would silently shadow the override.
  const findOverride = database.prepare(
    `SELECT id FROM retention_factors
     WHERE operation = ? AND nutrient = ?
       AND IFNULL(qualifier, '') = IFNULL(?, '')
       AND origin = 'user'`,
  );
  const insert = database.prepare(
    `INSERT INTO retention_factors (id, operation, qualifier, nutrient, factor, source, notes, origin)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'seed')`,
  );
  const mark = database.prepare("UPDATE retention_factors SET origin = 'seed' WHERE id = ?");

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const seed of SEED_FACTORS) {
      const existing = find.get(
        seed.operation,
        seed.nutrient,
        seed.qualifier,
        seed.factor,
        seed.source,
      ) as unknown as { id: string; origin: string } | undefined;

      if (existing) {
        if (existing.origin !== "seed") mark.run(existing.id);
        continue;
      }

      const override = findOverride.get(seed.operation, seed.nutrient, seed.qualifier);
      if (override) continue;

      insert.run(
        randomUUID(),
        seed.operation,
        seed.qualifier,
        seed.nutrient,
        seed.factor,
        seed.source,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      /* SQLite may already have rolled back */
    }
    throw error;
  }
}

/**
 * Reconcile the shipped retention factors after a user override is removed.
 *
 * A user override suppresses the fixture row for the same operation/nutrient
 * at boot. Deleting the override would otherwise leave no factor at all until
 * the next restart, which would silently change recipe results. The data purge
 * calls this after its transaction commits; boot calls the same seeder.
 */
export function reseedRetentionFactors(): void {
  seedRetentionFactors(db);
}

/**
 * The only identifiers `migrate()` may splice into DDL.
 *
 * `addColumn` interpolates `table` and `column` into `PRAGMA table_info`
 * and `ALTER TABLE`, so both must be a plain SQL identifier AND a name
 * this file's own migration list knows — syntactically valid alone is not
 * enough, and `definition` stays a string literal at each call site.
 */
const MIGRATION_TABLES = new Set([
  "profile",
  "recipes",
  "recipe_versions",
  "captured_food_nutrients",
  "retention_factors",
]);
const MIGRATION_COLUMNS = new Set([
  "body_fat_percent",
  "pace",
  "target_weight_kg",
  "target_energy_kcal",
  "archived_at",
  "label",
  "note",
  "origin",
]);

function assertDdlIdentifier(name: string, allowed: ReadonlySet<string>): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !allowed.has(name)) {
    throw new Error(`Refusing to run DDL for unknown identifier "${name}".`);
  }
}

function addColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): boolean {
  // Both interpolated call sites below are guarded: nothing reaches SQL
  // unless it is in the fixed migrate() lists above.
  assertDdlIdentifier(table, MIGRATION_TABLES);
  assertDdlIdentifier(column, MIGRATION_COLUMNS);

  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string;
  }>;

  if (columns.some((entry) => entry.name === column)) return false;

  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

export const db: DatabaseSync =
  globalForDb.__nutriplanDb ?? (globalForDb.__nutriplanDb = createDb());

/**
 * Run several statements atomically.
 *
 * A recipe save writes a recipe, a version, its components and their
 * inputs. A half-written version would be corrupt in a way that is
 * invisible to the UI, so this cannot be left to chance.
 */
export function transaction<T>(fn: () => T): T {
  // `BEGIN IMMEDIATE` takes the write lock up front. Every caller here reads
  // before it writes (`MAX(position)`, `MAX(version_no)`); a deferred BEGIN
  // fails instantly with SQLITE_BUSY_SNAPSHOT when another process commits in
  // that window, and `busy_timeout` does not cover that case.
  db.exec("BEGIN IMMEDIATE");
  let result: T;
  try {
    result = fn();
  } catch (error) {
    // SQLite may already have rolled back (SQLITE_FULL/IOERR/BUSY). A second
    // ROLLBACK then throws "no transaction is active" and hides the real
    // error, so the rollback is best effort and the original is rethrown.
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw error;
  }

  // A thenable would let COMMIT run before the async body finished. Refuse
  // rather than commit a half-applied write.
  if (result && typeof (result as { then?: unknown }).then === "function") {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw new Error("transaction() callback must be synchronous.");
  }

  try {
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw error;
  }
  return result;
}
