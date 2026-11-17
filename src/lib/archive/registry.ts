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
 */

export type TableClass = "user" | "optional";

export type TableSpec = {
  table: string;
  /** Shown in the import report. */
  label: string;
  class: TableClass;
  /** SQL predicate that keeps seed/derived rows out of the archive. */
  where?: string;
  /** Columns that must never be exported or written by an import. */
  omit?: readonly string[];
  /** For `optional` tables: include by default? */
  defaultInclude?: boolean;
};

/**
 * Settings an archive may restore. Anything else is dropped with a warning:
 * a future setting that changes behaviour must not be plantable by a file
 * the user was handed.
 */
export const IMPORTABLE_SETTINGS = new Set(["ai_master_prompt", "target_rules"]);

/**
 * The `app_settings` predicate, derived from the allowlist so export and
 * replace-import cannot drift: only keys this build can restore are exported,
 * and a replace deletes only those keys.
 */
const IMPORTABLE_SETTINGS_SQL = [...IMPORTABLE_SETTINGS]
  .map((key) => `'${key.replace(/'/g, "''")}'`)
  .join(", ");

/**
 * FK-safe order. Parents precede children; the wipe runs this in reverse.
 * `recipes.current_version_id` has no FK, so the cycle is not real.
 */
export const TABLES: readonly TableSpec[] = [
  { table: "profile", label: "Profile", class: "user" },
  { table: "recipes", label: "Recipes", class: "user" },
  { table: "recipe_versions", label: "Recipe versions", class: "user" },
  { table: "components", label: "Recipe blocks", class: "user" },
  { table: "component_inputs", label: "Recipe inputs", class: "user" },
  { table: "plans", label: "Plans", class: "user" },
  { table: "plan_entries", label: "Plan entries", class: "user" },
  { table: "entries", label: "Diary entries", class: "user" },
  { table: "captured_foods", label: "Captured foods", class: "user" },
  { table: "captured_food_nutrients", label: "Captured food nutrients", class: "user" },
  { table: "captured_food_portions", label: "Captured food portions", class: "user" },
  { table: "food_default_amounts", label: "Food default amounts", class: "user" },
  {
    table: "retention_factors",
    label: "Retention overrides",
    class: "user",
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
    where: `key IN (${IMPORTABLE_SETTINGS_SQL})`,
  },
  {
    table: "ai_calls",
    label: "AI activity log",
    class: "optional",
    defaultInclude: false,
  },
] as const;

export const TABLE_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(
  TABLES.map((spec) => [spec.table, spec]),
);

/** Tables in apply order for the given export options. */
export function tablesForExport(options: { includeAiCalls?: boolean } = {}): TableSpec[] {
  return TABLES.filter((spec) => spec.class === "user" || (spec.defaultInclude ?? false) || options.includeAiCalls);
}

/** Tables in apply order. The wipe reverses this. */
export function tablesForImport(archiveTables: ReadonlySet<string>): TableSpec[] {
  return TABLES.filter((spec) => archiveTables.has(spec.table));
}

/** Per-table ceilings. A personal archive is far below these. */
export const IMPORT_LIMITS = {
  maxRowsPerTable: 250_000,
  maxRowsTotal: 500_000,
  maxLineBytes: 1024 * 1024,
  maxManifestBytes: 2 * 1024 * 1024,
} as const;

export const ARCHIVE_FORMAT = "nutriplan.archive";
export const ARCHIVE_FORMAT_VERSION = 1;
