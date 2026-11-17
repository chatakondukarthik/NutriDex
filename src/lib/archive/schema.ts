import type { DatabaseSync } from "node:sqlite";
import { TABLE_BY_NAME } from "./registry";

/**
 * Columns are discovered, not declared.
 *
 * `PRAGMA table_info` is the truth for both export and import, so a column
 * added by a later migration is exported without a second edit, and an
 * import can tell "the archive predates this column" from "the archive
 * invented a column".
 */

export type ColumnInfo = {
  name: string;
  type: string;
  notnull: boolean;
  pk: number;
  /** SQL literal from SQLite, or null when the column has no default. */
  dfltValue: string | null;
};

/**
 * Table names are interpolated into `PRAGMA`/`SELECT`, so they are checked
 * against the registry first. A name that is not in the registry never
 * reaches SQL.
 */
export function assertKnownTable(table: string): void {
  if (!TABLE_BY_NAME.has(table)) throw new Error(`Unknown table "${table}".`);
}

export function columnsOf(database: DatabaseSync, table: string): ColumnInfo[] {
  assertKnownTable(table);
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
    dflt_value: string | null;
  }>;
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    notnull: row.notnull === 1,
    pk: row.pk,
    dfltValue: row.dflt_value,
  }));
}

/** Columns an import cannot synthesise if the archive omits them. */
export function requiredColumns(columns: readonly ColumnInfo[]): string[] {
  return columns
    .filter((column) => (column.notnull || column.pk > 0) && column.dfltValue === null)
    .map((column) => column.name);
}
