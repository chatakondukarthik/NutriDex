import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db/client";
import { dataFile, ensureDataDir } from "@/lib/data-dir";
import { PRIVATE_FILE_MODE, ensurePrivateDir } from "@/lib/security/private-files";
import {
  type ArchiveManifest,
  FILES_DIR,
  MANIFEST_PATH,
  SNAPSHOT_PATH,
  isSupportedFormat,
  tableFromDataPath,
} from "./manifest";
import {
  IMPORT_LIMITS,
  IMPORTABLE_SETTINGS,
  type TableSpec,
  TABLE_BY_NAME,
  tablesForImport,
} from "./registry";
import { columnsOf, requiredColumns } from "./schema";
import { ZipError, ZIP_LIMITS, readZip } from "./zip";

/**
 * Import is the only code path that accepts a file from outside this
 * machine, so it is written as a parser first and a writer second.
 *
 * The order is deliberate:
 *
 *   1. the ZIP container is validated (traversal, bombs, CRC);
 *   2. the manifest is validated and every checksum is verified;
 *   3. every NDJSON row is validated against the *live* schema;
 *   4. rows are applied inside one transaction, with a foreign-key check
 *      before commit;
 *   5. evidence files are written last, owner-only.
 *
 * A dry run executes steps 1–4 and rolls back, so "check this archive" is
 * the same code as "apply this archive" and cannot drift from it.
 */

export type ImportMode = "replace" | "merge";

export type ParsedTable = {
  spec: TableSpec;
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

export type ParsedArchive = {
  manifest: ArchiveManifest;
  tables: ParsedTable[];
  evidence: Map<string, Buffer>;
  warnings: string[];
};

export type TableReport = {
  table: string;
  label: string;
  archiveRows: number;
  added: number;
  kept: number;
  conflicts: number;
};

export type ImportReport = {
  ok: true;
  mode: ImportMode;
  dryRun: boolean;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  tables: TableReport[];
  files: { written: number; skipped: number };
  warnings: string[];
};

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

const EVIDENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * A free file name for restored bytes whose original name is taken by a
 * different image. The suffix is random, and the stem is truncated so the
 * result still satisfies `EVIDENCE_NAME` and stays in one path segment.
 */
function uniqueEvidenceName(dir: string, name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = `-${randomUUID().slice(0, 8)}`;
    const candidate = `${stem.slice(0, 128 - suffix.length - ext.length)}${suffix}${ext}`;
    if (EVIDENCE_NAME.test(candidate) && !existsSync(path.join(dir, candidate))) return candidate;
  }
  throw new ImportError("Could not find a free name for a restored evidence image.");
}

function sameBytes(file: string, data: Buffer): boolean {
  try {
    return readFileSync(file).equals(data);
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ImportError(message);
}

/* ------------------------------------------------------------------ */
/* Manifest                                                           */
/* ------------------------------------------------------------------ */

function validateManifest(raw: Buffer): ArchiveManifest {
  if (raw.length > IMPORT_LIMITS.maxManifestBytes) fail("The manifest is too large.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("The manifest is not valid JSON.");
  }
  if (!isPlainObject(parsed)) fail("The manifest is not an object.");

  const manifest = parsed as Partial<ArchiveManifest>;

  if (typeof manifest.format !== "string") fail("The archive has no format identifier.");
  if (!Number.isInteger(manifest.formatVersion)) fail("The archive has no format version.");
  if (!isSupportedFormat(manifest as ArchiveManifest)) {
    fail(
      `This archive uses format ${String(manifest.format)} v${String(manifest.formatVersion)}, ` +
        `which this version of NutriPlan cannot read.`,
    );
  }
  if (typeof manifest.exportedAt !== "string") fail("The archive has no export timestamp.");
  if (!isPlainObject(manifest.counts)) fail("The manifest has no row counts.");
  if (!isPlainObject(manifest.columns)) fail("The manifest has no column list.");
  if (!Array.isArray(manifest.files)) fail("The manifest has no file list.");
  if (!isPlainObject(manifest.includes)) fail("The manifest has no inclusion flags.");

  for (const file of manifest.files) {
    if (!isPlainObject(file) || typeof file.path !== "string") {
      fail("The manifest has a malformed file entry.");
    }
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      fail(`The manifest has no checksum for "${file.path}".`);
    }
  }

  // A duplicate path would make the last checksum win and silently skip
  // verification of the first. Refuse instead of guessing.
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (seen.has(file.path)) fail(`The manifest lists "${file.path}" twice.`);
    seen.add(file.path);
  }

  return manifest as ArchiveManifest;
}

/* ------------------------------------------------------------------ */
/* NDJSON                                                             */
/* ------------------------------------------------------------------ */

function parseNdjson(buffer: Buffer, table: string): Array<Record<string, unknown>> {
  if (buffer.length === 0) return [];
  const text = buffer.toString("utf8");
  const lines = text.split("\n");
  // A trailing newline produces one empty element; any other empty line is
  // malformed and should not be silently skipped.
  if (lines[lines.length - 1] === "") lines.pop();

  if (lines.length > IMPORT_LIMITS.maxRowsPerTable) {
    fail(`"${table}" has more than ${IMPORT_LIMITS.maxRowsPerTable} rows.`);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (Buffer.byteLength(line, "utf8") > IMPORT_LIMITS.maxLineBytes) {
      fail(`"${table}" line ${index + 1} is too long.`);
    }
    if (line.trim() === "") fail(`"${table}" line ${index + 1} is empty.`);

    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      fail(`"${table}" line ${index + 1} is not valid JSON.`);
    }
    if (!isPlainObject(row)) fail(`"${table}" line ${index + 1} is not an object.`);
    rows.push(row);
  }
  return rows;
}

/** Only the JSON scalar types SQLite can hold. Objects and arrays are refused. */
function coerceValue(value: unknown, table: string, column: string): string | number | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`"${table}.${column}" is not a finite number.`);
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  fail(`"${table}.${column}" has a value that is not a string, number or null.`);
}

/**
 * A local evidence path may be restored; anything else must be an `https:`
 * URL. This mirrors `safeImagePath` in `captured-food.ts` — import bypasses
 * the action boundary, so the rule has to exist here too.
 */
function safeImagePath(value: unknown, table: string, warnings: string[]): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  if (trimmed.length > 500) {
    warnings.push(`Dropped an over-long image path in "${table}".`);
    return null;
  }
  if (trimmed.startsWith("data/evidence/")) {
    const name = trimmed.slice("data/evidence/".length);
    if (EVIDENCE_NAME.test(name)) return trimmed;
    warnings.push(`Dropped an unsafe evidence path in "${table}".`);
    return null;
  }
  try {
    if (new URL(trimmed).protocol === "https:") return trimmed;
  } catch {
    /* fall through */
  }
  warnings.push(`Dropped a non-https image path in "${table}".`);
  return null;
}

/* ------------------------------------------------------------------ */
/* Parse                                                              */
/* ------------------------------------------------------------------ */

export function parseArchive(buffer: Buffer): ParsedArchive {
  const warnings: string[] = [];

  let zip: Map<string, Buffer>;
  try {
    // The snapshot is a recovery copy, never an import source. Skipping it
    // means a 64 MB upload cannot force a much larger allocation for a file
    // this code ignores.
    zip = readZip(buffer, ZIP_LIMITS, { skip: (name) => name === SNAPSHOT_PATH });
  } catch (error) {
    if (error instanceof ZipError) fail(error.message);
    throw error;
  }

  const manifestBytes = zip.get(MANIFEST_PATH);
  if (!manifestBytes) fail("That ZIP is not a NutriPlan archive (no manifest.json).");
  const manifest = validateManifest(manifestBytes);

  // Verify the archive is exactly what the manifest describes: no missing
  // entries, no extra entries, no checksum mismatch.
  const listed = new Map(manifest.files.map((file) => [file.path, file]));
  for (const [entryPath, data] of zip) {
    if (entryPath === MANIFEST_PATH) continue;
    const expected = listed.get(entryPath);
    if (!expected) fail(`The archive contains an unlisted file: "${entryPath}".`);
    const digest = createHash("sha256").update(data).digest("hex");
    if (digest !== expected.sha256) {
      fail(`Checksum mismatch for "${entryPath}". The archive is corrupt or was modified.`);
    }
    if (data.length !== expected.bytes) {
      fail(`Size mismatch for "${entryPath}".`);
    }
  }
  for (const file of manifest.files) {
    // A skipped snapshot is not verified, but it is also never read. Every
    // file the importer *does* use must be present.
    if (file.path === SNAPSHOT_PATH && !zip.has(file.path)) continue;
    if (!zip.has(file.path)) fail(`The archive is missing "${file.path}".`);
  }

  // Every data file must name a table this build knows. An unknown table at
  // a supported format version is either tampering or a newer build's table,
  // and dropping it would lose data silently.
  const tables: ParsedTable[] = [];
  let totalRows = 0;

  for (const [entryPath] of zip) {
    if (!entryPath.startsWith("data/")) continue;
    const table = tableFromDataPath(entryPath);
    if (!table || !TABLE_BY_NAME.has(table)) {
      fail(`The archive contains data for an unknown table: "${entryPath}".`);
    }
  }

  for (const [entryPath, data] of zip) {
    if (!entryPath.startsWith("data/")) continue;
    const table = tableFromDataPath(entryPath);
    if (!table) fail(`The archive contains a malformed data file: "${entryPath}".`);
    const spec = TABLE_BY_NAME.get(table);
    if (!spec) fail(`Unknown table "${table}".`);

    const live = columnsOf(db, spec.table);
    const liveNames = new Set(live.map((column) => column.name));
    const declaredRaw = manifest.columns[table];
    if (
      !Array.isArray(declaredRaw) ||
      declaredRaw.some((column) => typeof column !== "string")
    ) {
      fail(`The manifest has no valid column list for "${table}".`);
    }
    const declared = declaredRaw as string[];
    if (new Set(declared).size !== declared.length) {
      fail(`The manifest lists a column twice for "${table}".`);
    }

    const undeclaredManifestColumns = declared.filter(
      (column) => !liveNames.has(column) && !spec.omit?.includes(column),
    );
    if (undeclaredManifestColumns.length > 0) {
      warnings.push(
        `The manifest lists column(s) this build does not have in "${table}": ` +
          `${undeclaredManifestColumns.sort().join(", ")}.`,
      );
    }

    const declaredSet = new Set(declared);
    const unknownColumns = new Set<string>();
    const parsedRows = parseNdjson(data, table);

    // The manifest count is part of the archive's contract. A file with
    // fewer rows than promised is a truncated archive, not a merge to
    // silently accept; checksums prove the bytes, not that they are
    // complete.
    const declaredCount = manifest.counts[table];
    if (
      typeof declaredCount !== "number" ||
      !Number.isInteger(declaredCount) ||
      declaredCount < 0
    ) {
      fail(`The manifest has no valid row count for "${table}".`);
    }
    if (declaredCount !== parsedRows.length) {
      fail(
        `The manifest says "${table}" has ${declaredCount} row(s), but the file has ` +
          `${parsedRows.length}. The archive is incomplete or was modified.`,
      );
    }

    const rows = parsedRows.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (spec.omit?.includes(key)) continue;
        if (!declaredSet.has(key)) {
          // Older archives may lack a column; a row carrying a column the
          // manifest never listed is worth naming, but the row itself is
          // still usable.
          warnings.push(`"${table}" has an undeclared column "${key}".`);
        }
        if (!liveNames.has(key)) {
          unknownColumns.add(key);
          continue;
        }
        clean[key] = coerceValue(value, table, key);
      }
      if (table === "captured_foods" && "image_path" in clean) {
        clean.image_path = safeImagePath(clean.image_path, table, warnings);
      }
      if (table === "app_settings") {
        const key = clean.key;
        if (typeof key !== "string" || !IMPORTABLE_SETTINGS.has(key)) {
          return null;
        }
      }
      return clean;
    });

    if (unknownColumns.size > 0) {
      warnings.push(
        `Ignored unknown column(s) in "${table}": ${[...unknownColumns].sort().join(", ")}.`,
      );
    }

    const kept = rows.filter((row): row is Record<string, unknown> => row !== null);
    if (kept.length !== rows.length) {
      warnings.push(
        `Dropped ${rows.length - kept.length} setting(s) this version does not understand.`,
      );
    }

    totalRows += kept.length;
    if (totalRows > IMPORT_LIMITS.maxRowsTotal) {
      fail(`The archive has more than ${IMPORT_LIMITS.maxRowsTotal} rows.`);
    }

    tables.push({ spec, columns: declared, rows: kept });
  }

  // Evidence files travel under `files/`. Anything else in `files/` is not
  // part of the format yet and is refused rather than guessed at.
  const evidence = new Map<string, Buffer>();
  for (const [entryPath, data] of zip) {
    if (!entryPath.startsWith(FILES_DIR)) continue;
    const relative = entryPath.slice(FILES_DIR.length);
    if (!relative.startsWith("evidence/")) {
      fail(`The archive contains an unsupported file: "${entryPath}".`);
    }
    const name = relative.slice("evidence/".length);
    if (!EVIDENCE_NAME.test(name)) fail(`The archive contains an unsafe file name: "${entryPath}".`);
    evidence.set(name, data);
  }

  return { manifest, tables, evidence, warnings };
}

/* ------------------------------------------------------------------ */
/* Apply                                                              */
/* ------------------------------------------------------------------ */

type ColumnInfo = ReturnType<typeof columnsOf>[number];

function primaryKey(columns: readonly ColumnInfo[]): string[] {
  return columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
}

function sameRow(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  columns: readonly string[],
): boolean {
  return columns.every((column) => {
    const a = existing[column] ?? null;
    const b = incoming[column] ?? null;
    return a === b;
  });
}

function validateRequired(
  table: string,
  rows: readonly Record<string, unknown>[],
  required: readonly string[],
): void {
  for (let index = 0; index < rows.length; index += 1) {
    for (const column of required) {
      if (!(column in rows[index])) {
        fail(`"${table}" row ${index + 1} is missing the required field "${column}".`);
      }
    }
  }
}

export function applyArchive(
  parsed: ParsedArchive,
  options: { mode: ImportMode; dryRun?: boolean } = { mode: "merge" },
): ImportReport {
  const mode = options.mode;
  const dryRun = options.dryRun ?? false;
  const warnings = [...parsed.warnings];
  const report: TableReport[] = [];
  const present = new Set(parsed.tables.map((table) => table.spec.table));
  const ordered = tablesForImport(present);

  let written = 0;
  let skipped = 0;
  // Files created by this import. If the transaction rolls back, they are
  // removed so a failed import leaves no half-restored evidence behind.
  const createdFiles: string[] = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    if (mode === "replace") {
      // Reverse FK order. Retention overrides are deleted selectively: the
      // seeded factors are code fixtures and must survive. Settings use the
      // allowlist predicate, so a replace cannot delete a setting this
      // build would refuse to restore.
      for (const spec of [...ordered].reverse()) {
        db.exec(spec.where ? `DELETE FROM ${spec.table} WHERE ${spec.where}` : `DELETE FROM ${spec.table}`);
      }
    }

    for (const spec of ordered) {
      const parsedTable = parsed.tables.find((table) => table.spec.table === spec.table);
      if (!parsedTable) continue;

      if (parsedTable.rows.length === 0) {
        // An empty table still appears in the report, and in `replace` mode
        // it was already cleared by the delete loop above. There is no
        // INSERT to build: `INSERT INTO t () VALUES ()` is a syntax error.
        report.push({
          table: spec.table,
          label: spec.label,
          archiveRows: 0,
          added: 0,
          kept: 0,
          conflicts: 0,
        });
        continue;
      }

      const columns = columnsOf(db, spec.table);
      const liveNames = new Set(columns.map((column) => column.name));
      validateRequired(
        spec.table,
        parsedTable.rows,
        requiredColumns(columns).filter((column) => liveNames.has(column)),
      );

      const keys = primaryKey(columns);
      if (keys.length === 0) fail(`"${spec.table}" has no primary key, so it cannot be merged.`);

      const candidateColumns = columns
        .map((column) => column.name)
        .filter(
          (name) =>
            !spec.omit?.includes(name) && parsedTable.rows.some((row) => name in row),
        );

      // A column omitted by an older archive must be omitted from the
      // INSERT too, so SQLite applies the column default. Using a table-wide
      // union and writing `null` for a row that predates the column would
      // either fail a NOT NULL constraint or store null where the default
      // was meant to apply.
      const inserts = new Map<string, ReturnType<typeof db.prepare>>();
      const insertFor = (rowColumns: readonly string[]) => {
        const cacheKey = rowColumns.join("\u0000");
        let statement = inserts.get(cacheKey);
        if (!statement) {
          statement = db.prepare(
            `INSERT INTO ${spec.table} (${rowColumns.join(", ")})
             VALUES (${rowColumns.map(() => "?").join(", ")})`,
          );
          inserts.set(cacheKey, statement);
        }
        return statement;
      };
      const find = db.prepare(
        `SELECT * FROM ${spec.table}
         WHERE ${keys.map((key) => `${key} = ?`).join(" AND ")}`,
      );

      let added = 0;
      let kept = 0;
      let conflicts = 0;

      for (let rowIndex = 0; rowIndex < parsedTable.rows.length; rowIndex += 1) {
        const row = parsedTable.rows[rowIndex];
        const rowColumns = candidateColumns.filter((column) => column in row);
        const values = rowColumns.map(
          (column) => (row[column] ?? null) as string | number | null,
        );

        if (mode === "merge") {
          const keyValues = keys.map((key) => (row[key] ?? null) as string | number | null);
          const existing = find.get(...keyValues) as unknown as
            | Record<string, unknown>
            | undefined;
          if (existing) {
            if (sameRow(existing, row, rowColumns)) kept += 1;
            else conflicts += 1;
            continue;
          }
        }

        try {
          insertFor(rowColumns).run(...values);
          added += 1;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          // Merge never overwrites. A row that collides on a unique field
          // (for example a plan for the same week under a different id) is
          // a conflict to report, not a row to drop silently.
          if (mode === "merge" && /UNIQUE constraint failed/i.test(detail)) {
            conflicts += 1;
            continue;
          }
          fail(
            `The archive is inconsistent: "${spec.table}" row ${rowIndex + 1} ` +
              `could not be applied (${detail}). Nothing was changed.`,
          );
        }
      }

      report.push({
        table: spec.table,
        label: spec.label,
        archiveRows: parsedTable.rows.length,
        added,
        kept,
        conflicts,
      });
    }

    const broken = db.prepare("PRAGMA foreign_key_check").all() as unknown as Array<{
      table: string;
      rowid: number;
      parent: string;
    }>;
    if (broken.length > 0) {
      const first = broken[0];
      fail(
        `The archive is inconsistent: ${broken.length} row(s) point at data that is not ` +
          `in the archive (e.g. "${first.table}" -> "${first.parent}"). Nothing was changed.`,
      );
    }

    // Evidence is written *before* commit, so a full disk or a permission
    // error fails the import instead of committing rows that point at files
    // which were never written. On rollback, anything created here is
    // removed.
    if (!dryRun && parsed.evidence.size > 0) {
      ensureDataDir();
      const dir = dataFile("evidence");
      ensurePrivateDir(dir);
      const rewrite = db.prepare(
        "UPDATE captured_foods SET image_path = ? WHERE image_path = ?",
      );

      for (const [name, data] of parsed.evidence) {
        let target = path.join(dir, name);
        try {
          writeFileSync(target, data, { mode: PRIVATE_FILE_MODE, flag: "wx" });
          createdFiles.push(target);
          written += 1;
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            fail(`Could not restore evidence image "${name}". Nothing was changed.`);
          }
        }

        // The name already exists. Same bytes is a no-op (re-importing the
        // same archive); different bytes must never be mistaken for the
        // archive's image.
        if (sameBytes(target, data)) {
          skipped += 1;
          continue;
        }

        if (mode === "merge") {
          warnings.push(
            `Evidence image "${name}" already exists with different content; ` +
              "the existing file was kept.",
          );
          skipped += 1;
          continue;
        }

        // Replace mode: the archive wins. Store the new bytes under a new
        // name and repoint the rows that were just inserted, rather than
        // overwriting a file another row may still reference.
        const renamed = uniqueEvidenceName(dir, name);
        target = path.join(dir, renamed);
        writeFileSync(target, data, { mode: PRIVATE_FILE_MODE, flag: "wx" });
        createdFiles.push(target);
        rewrite.run(`data/evidence/${renamed}`, `data/evidence/${name}`);
        written += 1;
      }
    } else if (dryRun) {
      skipped = parsed.evidence.size;
    }

    if (dryRun) {
      db.exec("ROLLBACK");
    } else {
      db.exec("COMMIT");
    }
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* SQLite may already have rolled back */
    }
    for (const file of createdFiles) {
      try {
        unlinkSync(file);
      } catch {
        /* best effort */
      }
    }
    throw error;
  }

  if (mode === "merge") {
    const conflicted = report.filter((table) => table.conflicts > 0);
    if (conflicted.length > 0) {
      warnings.push(
        "Some rows already existed with different values and were left as they are: " +
          conflicted.map((table) => `${table.label} (${table.conflicts})`).join(", ") +
          ". Use Replace if the archive should win.",
      );
    }
  }

  return {
    ok: true,
    mode,
    dryRun,
    formatVersion: parsed.manifest.formatVersion,
    appVersion: parsed.manifest.appVersion,
    exportedAt: parsed.manifest.exportedAt,
    tables: report,
    files: { written, skipped },
    warnings,
  };
}

/** Convenience: parse and apply in one call. */
export function importArchive(
  buffer: Buffer,
  options: { mode: ImportMode; dryRun?: boolean },
): ImportReport {
  return applyArchive(parseArchive(buffer), options);
}
