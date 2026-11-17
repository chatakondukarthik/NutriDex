import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
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

  CREATE TABLE IF NOT EXISTS entries (
    id                TEXT PRIMARY KEY,
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

  CREATE INDEX IF NOT EXISTS entries_day_idx ON entries (day, created_at);

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

  CREATE TABLE IF NOT EXISTS profile (
    id               TEXT PRIMARY KEY,
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
    updated_at       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plans (
    id         TEXT PRIMARY KEY,
    starts_on  TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
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
    notes      TEXT
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
  -- too (they live in code, not in a table).
  CREATE TABLE IF NOT EXISTS food_default_amounts (
    food_id    TEXT PRIMARY KEY,
    amount     REAL NOT NULL,
    unit       TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
  migrate(database);
  seedRetentionFactors(database);
  restrictDbFiles(dbPath);

  return database;
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
function migrate(database: DatabaseSync): void {
  addColumn(database, "profile", "body_fat_percent", "REAL");
  addColumn(database, "profile", "pace", "TEXT NOT NULL DEFAULT 'steady'");
  addColumn(database, "profile", "target_weight_kg", "REAL");
  addColumn(database, "recipe_versions", "label", "TEXT");
  addColumn(database, "profile", "target_energy_kcal", "REAL");
  addColumn(database, "recipes", "archived_at", "TEXT");
  addColumn(database, "captured_food_nutrients", "note", "TEXT");
  rebuildEntriesTable(database);
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
 * Seed the retention-factor table once. Runs on every boot; inserts are
 * guarded by a lookup so it is idempotent. Wrapped in a transaction so a
 * crash mid-loop cannot leave a partial seed that the count check then
 * treats as complete.
 */
function seedRetentionFactors(database: DatabaseSync): void {
  const count = database
    .prepare("SELECT COUNT(*) AS n FROM retention_factors")
    .get() as unknown as { n: number };
  if (count.n > 0) return;

  const insert = database.prepare(
    `INSERT INTO retention_factors (id, operation, qualifier, nutrient, factor, source, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const seed of SEED_FACTORS) {
      insert.run(
        randomUUID(),
        seed.operation,
        seed.qualifier,
        seed.nutrient,
        seed.factor,
        seed.source,
        null,
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
]);
const MIGRATION_COLUMNS = new Set([
  "body_fat_percent",
  "pace",
  "target_weight_kg",
  "target_energy_kcal",
  "archived_at",
  "label",
  "note",
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
): void {
  // Both interpolated call sites below are guarded: nothing reaches SQL
  // unless it is in the fixed migrate() lists above.
  assertDdlIdentifier(table, MIGRATION_TABLES);
  assertDdlIdentifier(column, MIGRATION_COLUMNS);

  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string;
  }>;

  if (columns.some((entry) => entry.name === column)) return;

  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
