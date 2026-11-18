/**
 * The archive contract.
 *
 * One ordered list decides what an export contains, what an import accepts,
 * and what a wipe deletes. Adding a table to the app means adding it here;
 * forgetting means the data is visibly absent from an export, which the
 * round-trip test catches (`tests/archive.test.ts`).
 *
 * Columns are *not* listed. They are read from `PRAGMA table_info` at export
 * time, so a column added by a later migration cannot silently vanish from
 * the archive. `omit` is the explicit exception, and it names only columns
 * the app manages rather than the user.
 *
 * Every table also declares its scope (D-051):
 *
 *   - `installation`: the household row and the people roster. A person
 *     export carries only that person and their household row.
 *   - `personal`: rows that belong to one person.
 *   - `shared`: the household's food and recipe library.
 *   - `operational`: logs and caches that travel only when explicitly asked
 *     for, and only in a household archive.
 */

export type TableClass = "user" | "optional";

export type TableScope = "installation" | "personal" | "shared" | "operational";

/** The three archive shapes a user can choose. */
export type ArchiveScope = "household" | "person" | "shared";

export type TableSpec = {
  table: string;
  /** Shown in the import report. */
  label: string;
  class: TableClass;
  scope: TableScope;
  /** SQL predicate that keeps seed/derived rows out of the archive. */
  where?: string;
  /** Columns that must never be exported or written by an import. */
  omit?: readonly string[];
  /** For `optional` tables: include by default? */
  defaultInclude?: boolean;
};

/**
 * Settings an archive may restore into `app_settings`.
 *
 * This list is household-wide. `target_rules` is personal and lives in
 * `person_settings`; it is accepted from a v1 archive only, where it used to
 * be an `app_settings` row.
 */
export const IMPORTABLE_SETTINGS = new Set(["ai_master_prompt"]);

/** v1 `app_settings` keys that move to `person_settings` during import. */
export const LEGACY_PERSON_SETTINGS = new Set(["target_rules"]);

/** `person_settings` keys an archive may restore. */
export const IMPORTABLE_PERSON_SETTINGS = new Set(["target_rules"]);

function sqlList(values: Iterable<string>): string {
  return [...values].map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

/**
 * The `app_settings` predicate, derived from the allowlist so export and
 * replace-import cannot drift: only keys this build can restore are exported,
 * and a replace deletes only those keys.
 */
const IMPORTABLE_SETTINGS_SQL = sqlList(IMPORTABLE_SETTINGS);
const IMPORTABLE_PERSON_SETTINGS_SQL = sqlList(IMPORTABLE_PERSON_SETTINGS);

/**
 * FK-safe order. Parents precede children; the wipe runs this in reverse.
 * `recipes.current_version_id` has no FK, so the cycle is not real.
 */
export const TABLES: readonly TableSpec[] = [
  { table: "households", label: "Households", class: "user", scope: "installation" },
  { table: "people", label: "People", class: "user", scope: "installation" },
  { table: "profile", label: "Profiles", class: "user", scope: "personal" },
  { table: "recipes", label: "Recipes", class: "user", scope: "shared" },
  { table: "recipe_versions", label: "Recipe versions", class: "user", scope: "shared" },
  { table: "components", label: "Recipe blocks", class: "user", scope: "shared" },
  { table: "component_inputs", label: "Recipe inputs", class: "user", scope: "shared" },
  { table: "plans", label: "Plans", class: "user", scope: "personal" },
  { table: "plan_entries", label: "Plan entries", class: "user", scope: "personal" },
  { table: "entries", label: "Diary entries", class: "user", scope: "personal" },
  { table: "captured_foods", label: "Captured foods", class: "user", scope: "shared" },
  {
    table: "captured_food_nutrients",
    label: "Captured food nutrients",
    class: "user",
    scope: "shared",
  },
  {
    table: "captured_food_portions",
    label: "Captured food portions",
    class: "user",
    scope: "shared",
  },
  {
    table: "food_default_amounts",
    label: "Food default amounts",
    class: "user",
    scope: "personal",
  },
  {
    table: "person_settings",
    label: "Personal settings",
    class: "user",
    scope: "personal",
    where: `key IN (${IMPORTABLE_PERSON_SETTINGS_SQL})`,
  },
  {
    table: "retention_factors",
    label: "Retention overrides",
    class: "user",
    scope: "shared",
    // Seed factors ship with the app and are re-created on boot. Only the
    // user's own rows are content.
    where: "origin = 'user'",
    // `origin` is app-managed classification, not user content. If an
    // archive could write it, a crafted file could mark a row `seed` and
    // hide it from every future export. It is never read from an archive;
    // an imported row takes the column default (`user`).
    omit: ["origin"],
  },
  {
    table: "app_settings",
    label: "Settings",
    class: "user",
    scope: "shared",
    where: `key IN (${IMPORTABLE_SETTINGS_SQL})`,
  },
  {
    table: "ai_calls",
    label: "AI activity log",
    class: "optional",
    scope: "operational",
    defaultInclude: false,
  },
] as const;

export const TABLE_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(
  TABLES.map((spec) => [spec.table, spec]),
);

/** Tables in apply order for the given export options. */
export function tablesForExport(options: { includeAiCalls?: boolean } = {}): TableSpec[] {
  return TABLES.filter(
    (spec) => spec.class === "user" || options.includeAiCalls || (spec.defaultInclude ?? false),
  );
}

/** Tables in apply order. The wipe reverses this. */
export function tablesForImport(archiveTables: ReadonlySet<string>): TableSpec[] {
  return TABLES.filter((spec) => archiveTables.has(spec.table));
}

/**
 * The predicate that selects one person's rows in a personal table.
 *
 * `plan_entries` has no `person_id`; it is selected through `plans`, which is
 * the single source of truth for ownership.
 */
export function personalWhere(table: string): string | null {
  switch (table) {
    case "profile":
      return "id = ?";
    case "plans":
      return "person_id = ?";
    case "plan_entries":
      return "plan_id IN (SELECT id FROM plans WHERE person_id = ?)";
    case "entries":
      return "person_id = ?";
    case "food_default_amounts":
      return "person_id = ?";
    case "person_settings":
      return `person_id = ? AND key IN (${IMPORTABLE_PERSON_SETTINGS_SQL})`;
    default:
      return null;
  }
}

/** Does a table belong in an export of this scope before row filtering? */
export function tableInScope(spec: TableSpec, scope: ArchiveScope): boolean {
  if (scope === "household") return true;
  if (scope === "shared") return spec.scope === "shared";
  // A person archive is self-contained: their personal rows plus the whole
  // shared library, and just their household row and people row.
  return spec.scope !== "operational";
}

/** Per-table ceilings. A personal archive is far below these. */
export const IMPORT_LIMITS = {
  maxRowsPerTable: 250_000,
  maxRowsTotal: 500_000,
  maxLineBytes: 1024 * 1024,
  maxManifestBytes: 2 * 1024 * 1024,
} as const;

export const ARCHIVE_FORMAT = "nutriplan.archive";
export const ARCHIVE_FORMAT_VERSION = 2;
