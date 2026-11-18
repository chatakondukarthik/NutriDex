import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db/client";
import { defaultPersonId, getHousehold, getPerson } from "@/lib/db/people";
import { dataFile, ensureDataDir } from "@/lib/data-dir";
import { PRIVATE_FILE_MODE, ensurePrivateDir } from "@/lib/security/private-files";
import {
  ARCHIVE_SCOPES,
  type ArchiveManifest,
  FILES_DIR,
  MANIFEST_PATH,
  SNAPSHOT_PATH,
  isSupportedFormat,
  tableFromDataPath,
} from "./manifest";
import {
  IMPORT_LIMITS,
  IMPORTABLE_PERSON_SETTINGS,
  IMPORTABLE_SETTINGS,
  LEGACY_PERSON_SETTINGS,
  type ArchiveScope,
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
 * A dry run executes steps 1–4 and rolls back, so "check this archive" is the
 * same code as "apply this archive" and cannot drift from it.
 *
 * Version 2 adds scopes. A person archive is filtered to that person and the
 * shared library; a shared archive carries no people at all. A v1 archive is
 * mapped to one person before it is applied, and replace is refused in a
 * multi-person household because a v1 archive cannot name whose rows it owns.
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
  scope: ArchiveScope;
  personId: string | null;
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

export type ApplyOptions = {
  mode: ImportMode;
  dryRun?: boolean;
  /**
   * Write a person archive's rows to this person. Used by a v1 archive and by
   * "restore this person as me". The id is validated against the roster.
   */
  targetPersonId?: string;
};

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

  if (manifest.formatVersion === 1) {
    // A v1 archive predates households. It is one person's archive whether or
    // not it says so; the importer assigns it to a target person.
    manifest.scope = "person";
    manifest.householdId = "";
    manifest.personId = null;
  } else {
    if (!ARCHIVE_SCOPES.includes(manifest.scope as ArchiveScope)) {
      fail("The archive has an unknown scope.");
    }
    if (typeof manifest.householdId !== "string" || manifest.householdId.trim() === "") {
      fail("The archive does not name its household.");
    }
    if (manifest.scope === "person") {
      if (typeof manifest.personId !== "string" || manifest.personId.trim() === "") {
        fail("This is a person archive, but it does not name the person.");
      }
    } else if (manifest.personId != null) {
      fail("This archive's scope does not carry a person.");
    }
    if (manifest.scope !== "household" && manifest.includes.snapshot === true) {
      fail("A person or shared archive cannot contain a full database snapshot.");
    }
  }

  if (manifest.includes.secrets !== false) {
    fail("The manifest claims to include secrets. Refusing to import it.");
  }

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
  const isV1 = manifest.formatVersion === 1;

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
  for (const [entryPath] of zip) {
    if (!entryPath.startsWith("data/")) continue;
    const table = tableFromDataPath(entryPath);
    if (!table || !TABLE_BY_NAME.has(table)) {
      fail(`The archive contains data for an unknown table: "${entryPath}".`);
    }
  }

  const tables: ParsedTable[] = [];
  let totalRows = 0;

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
        const allowed =
          typeof key === "string" &&
          (IMPORTABLE_SETTINGS.has(key) || (isV1 && LEGACY_PERSON_SETTINGS.has(key)));
        if (!allowed) return null;
      }
      if (table === "person_settings") {
        const key = clean.key;
        if (typeof key !== "string" || !IMPORTABLE_PERSON_SETTINGS.has(key)) return null;
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

function tableRows(parsed: ParsedArchive, table: string): Array<Record<string, unknown>> {
  return parsed.tables.find((entry) => entry.spec.table === table)?.rows ?? [];
}

/**
 * Reject a v2 archive whose rows disagree with the scope it declares.
 *
 * Checksums prove the archive was not corrupted; they do not prove the
 * manifest's scope is honest. These checks make a person archive unable to
 * carry another person's diary into a replace, and a shared archive unable to
 * carry people at all.
 */
function assertScopeShape(parsed: ParsedArchive): void {
  const isV1 = parsed.manifest.formatVersion === 1;
  if (isV1) return;

  const scope = parsed.manifest.scope;
  const personId = parsed.manifest.personId;

  if (scope === "shared") {
    for (const table of parsed.tables) {
      if (table.spec.scope !== "shared" && table.rows.length > 0) {
        fail(
          `This archive says it is a shared library, but it contains ${table.spec.label.toLowerCase()}. Nothing was changed.`,
        );
      }
    }
    return;
  }

  if (scope === "person") {
    const households = tableRows(parsed, "households");
    const people = tableRows(parsed, "people");
    if (households.length !== 1) {
      fail("This person archive does not contain exactly one household row.");
    }
    if (people.length !== 1 || people[0].id !== personId) {
      fail("This person archive does not contain exactly one matching person row.");
    }

    const check = (table: string, column: string) => {
      for (const row of tableRows(parsed, table)) {
        if (row[column] !== personId) {
          fail(
            `This person archive contains ${table} rows for another person. Nothing was changed.`,
          );
        }
      }
    };
    check("profile", "id");
    check("plans", "person_id");
    check("entries", "person_id");
    check("food_default_amounts", "person_id");
    check("person_settings", "person_id");

    // A crafted plan entry must not point at an existing plan that belongs to
    // someone else. The archive's own plans table is the allowlist.
    const planIds = new Set(tableRows(parsed, "plans").map((row) => String(row.id)));
    for (const row of tableRows(parsed, "plan_entries")) {
      if (!planIds.has(String(row.plan_id))) {
        fail("This person archive contains a plan entry whose plan is not in the archive.");
      }
    }
    return;
  }

  const households = tableRows(parsed, "households");
  if (households.length !== 1) {
    fail("This household archive does not contain exactly one household row.");
  }

  // The archive's own plans table is the only allowlist for plan entries.
  // Without this, a crafted household archive could name a local plan that is
  // not in the archive and attach rows to another person's week.
  const planIds = new Set(tableRows(parsed, "plans").map((row) => String(row.id)));
  for (const row of tableRows(parsed, "plan_entries")) {
    if (!planIds.has(String(row.plan_id))) {
      fail("This household archive contains a plan entry whose plan is not in the archive.");
    }
  }
}

/**
 * Move a v1 `app_settings.target_rules` row to `person_settings`.
 *
 * v1 had one person and stored target rules in `app_settings`. The row is
 * removed from `app_settings` and appended to `person_settings` so the rest of
 * the pipeline has one shape.
 */
function normaliseLegacySettings(
  parsed: ParsedArchive,
  personId: string,
  warnings: string[],
): void {
  const appSettings = parsed.tables.find((table) => table.spec.table === "app_settings");
  if (!appSettings) return;

  const moved: Array<Record<string, unknown>> = [];
  const kept: Array<Record<string, unknown>> = [];
  for (const row of appSettings.rows) {
    if (row.key === "target_rules") {
      moved.push({
        person_id: personId,
        key: "target_rules",
        value: row.value,
        updated_at: new Date().toISOString(),
      });
    } else {
      kept.push(row);
    }
  }
  appSettings.rows = kept;
  if (moved.length === 0) return;

  let personSettings = parsed.tables.find((table) => table.spec.table === "person_settings");
  if (!personSettings) {
    const spec = TABLE_BY_NAME.get("person_settings");
    if (!spec) fail("This build cannot restore personal settings.");
    personSettings = {
      spec,
      columns: ["person_id", "key", "value", "updated_at"],
      rows: [],
    };
    parsed.tables.push(personSettings);
  }
  personSettings.rows.push(...moved);
  warnings.push("Moved target rules from v1 settings to the target person.");
}

type PersonContext = {
  /** The person every personal row is written to. */
  id: string;
  /** True when `id` did not exist and a people row must be inserted. */
  needsRow: boolean;
  source: Record<string, unknown> | null;
};

function resolvePersonTarget(
  parsed: ParsedArchive,
  options: ApplyOptions,
): PersonContext {
  const isV1 = parsed.manifest.formatVersion === 1;

  if (isV1) {
    const id = options.targetPersonId ?? defaultPersonId();
    if (!getPerson(id)) fail("The person to restore this v1 archive into no longer exists.");
    return { id, needsRow: false, source: null };
  }

  const archivePersonId = parsed.manifest.personId as string;
  const source = tableRows(parsed, "people").find((row) => row.id === archivePersonId) ?? null;

  if (options.targetPersonId) {
    if (!getPerson(options.targetPersonId)) {
      fail("The person to restore this archive into no longer exists.");
    }
    return { id: options.targetPersonId, needsRow: false, source };
  }

  if (getPerson(archivePersonId)) {
    return { id: archivePersonId, needsRow: false, source };
  }

  return { id: archivePersonId, needsRow: true, source };
}

/**
 * Transform rows for the target scope.
 *
 * Shared rows are unchanged. Personal rows are rewritten to the import
 * person. A household merge keeps this installation's household row and
 * folds the archive's people into it; a household replace keeps the archive's
 * household row because every table is replaced together.
 *
 * When a person archive is restored into a *different* person, the personal
 * rows get fresh primary keys. The archive usually comes from this same
 * installation, so its plan and diary ids already exist; reusing them would
 * either collide or attach the target person's new plan entries to the source
 * person's plan. Shared rows keep their ids because they are merged by
 * identity, not copied.
 */
function prepareTables(
  parsed: ParsedArchive,
  scope: ArchiveScope,
  mode: ImportMode,
  person: PersonContext | null,
  currentHouseholdId: string,
): ParsedTable[] {
  const isV1 = parsed.manifest.formatVersion === 1;
  const result: ParsedTable[] = [];

  // A v1 archive has no source person id. The original person is this
  // installation's default; any other target is a copy.
  const remapPersonalIds =
    scope === "person" &&
    person !== null &&
    (isV1 ? person.id !== defaultPersonId() : person.id !== parsed.manifest.personId);

  const remappedPlans = new Map<string, string>();
  if (remapPersonalIds) {
    const plans = parsed.tables.find((table) => table.spec.table === "plans");
    for (const row of plans?.rows ?? []) {
      remappedPlans.set(String(row.id), randomUUID());
    }
  }

  // A household merge can receive plan ids that already exist here for a
  // different person (a copy of the same installation, or a crafted archive).
  // Reusing the id would insert the archive's plan entries into the local
  // person's plan. Re-key those plans, and fold a foreign plan that lands on
  // the same person/week onto the plan that already exists.
  const mergedPlans = new Map<string, string>();
  if (scope === "household" && mode === "merge") {
    const plans = parsed.tables.find((table) => table.spec.table === "plans");
    const byId = db.prepare(
      "SELECT id, person_id, starts_on FROM plans WHERE id = ?",
    );
    const byWeek = db.prepare(
      "SELECT id FROM plans WHERE person_id = ? AND starts_on = ?",
    );
    for (const row of plans?.rows ?? []) {
      const id = String(row.id);
      let mapped = id;
      const existing = byId.get(id) as unknown as
        | { id: string; person_id: string; starts_on: string }
        | undefined;
      if (
        existing &&
        (existing.person_id !== row.person_id || existing.starts_on !== row.starts_on)
      ) {
        mapped = randomUUID();
      }
      const sameWeek = byWeek.get(
        String(row.person_id),
        String(row.starts_on),
      ) as unknown as { id: string } | undefined;
      if (sameWeek) mapped = sameWeek.id;
      if (mapped !== id) mergedPlans.set(id, mapped);
    }
  }

  for (const table of parsed.tables) {
    if (isV1 && table.spec.table === "profile") {
      table.rows = table.rows.map((row) => ({ ...row, id: person?.id }));
    } else if (isV1 && table.spec.table === "households") {
      continue;
    }

    if (scope === "shared") {
      if (table.spec.scope === "shared") result.push(table);
      continue;
    }

    if (scope === "person") {
      if (table.spec.table === "households" || table.spec.table === "people") continue;
      if (table.spec.scope === "operational") continue;

      if (table.spec.scope === "personal" && person) {
        if (table.spec.table === "profile") {
          table.rows = table.rows.map((row) => ({ ...row, id: person.id }));
        } else if (table.spec.table !== "plan_entries") {
          // `plan_entries` has no person column: its plan owns it.
          table.rows = table.rows.map((row) => ({ ...row, person_id: person.id }));
        }

        if (remapPersonalIds) {
          if (table.spec.table === "plans") {
            table.rows = table.rows.map((row) => ({
              ...row,
              id: remappedPlans.get(String(row.id)) ?? row.id,
            }));
          } else if (table.spec.table === "plan_entries") {
            table.rows = table.rows.map((row) => ({
              ...row,
              id: randomUUID(),
              plan_id: remappedPlans.get(String(row.plan_id)) ?? row.plan_id,
            }));
          } else if (table.spec.table === "entries") {
            table.rows = table.rows.map((row) => ({ ...row, id: randomUUID() }));
          }
        }
      }
      result.push(table);
      continue;
    }

    // Household scope.
    if (table.spec.table === "households") {
      if (mode === "merge") continue;
      result.push(table);
      continue;
    }
    if (table.spec.table === "people") {
      // `households` always has exactly one row. A merge must not create a
      // second household; the archived people join this installation's.
      table.rows = table.rows.map((row) => ({
        ...row,
        household_id: mode === "merge" ? currentHouseholdId : row.household_id,
      }));
      result.push(table);
      continue;
    }
    if (mergedPlans.size > 0) {
      if (table.spec.table === "plans") {
        table.rows = table.rows.map((row) => ({
          ...row,
          id: mergedPlans.get(String(row.id)) ?? row.id,
        }));
      } else if (table.spec.table === "plan_entries") {
        table.rows = table.rows.map((row) => ({
          ...row,
          plan_id: mergedPlans.get(String(row.plan_id)) ?? row.plan_id,
        }));
      }
    }
    result.push(table);
  }

  return result;
}

function deleteScoped(
  scope: ArchiveScope,
  person: PersonContext | null,
  present: ReadonlySet<string>,
): void {
  if (scope === "person") {
    if (!person) fail("A person archive needs a target person.");
    const id = person.id;
    db.prepare(
      "DELETE FROM plan_entries WHERE plan_id IN (SELECT id FROM plans WHERE person_id = ?)",
    ).run(id);
    db.prepare("DELETE FROM plans WHERE person_id = ?").run(id);
    db.prepare("DELETE FROM entries WHERE person_id = ?").run(id);
    db.prepare("DELETE FROM food_default_amounts WHERE person_id = ?").run(id);
    db.prepare("DELETE FROM person_settings WHERE person_id = ?").run(id);
    db.prepare("DELETE FROM profile WHERE id = ?").run(id);
    return;
  }

  if (scope === "shared") {
    db.exec("DELETE FROM component_inputs");
    db.exec("DELETE FROM components");
    db.exec("DELETE FROM recipe_versions");
    db.exec("DELETE FROM recipes");
    db.exec("DELETE FROM captured_food_nutrients");
    db.exec("DELETE FROM captured_food_portions");
    db.exec("DELETE FROM captured_foods");
    db.exec("DELETE FROM retention_factors WHERE origin = 'user'");
    const keys = [...IMPORTABLE_SETTINGS];
    if (keys.length > 0) {
      db.prepare(
        `DELETE FROM app_settings WHERE key IN (${keys.map(() => "?").join(", ")})`,
      ).run(...keys);
    }
    return;
  }

  // Household replace. Children before parents. The optional AI log is only
  // cleared when the archive carried it, so a content archive does not
  // silently erase operational history.
  db.exec("DELETE FROM person_settings");
  for (const table of [
    "food_default_amounts",
    "captured_food_portions",
    "captured_food_nutrients",
    "captured_foods",
    "entries",
    "plan_entries",
    "plans",
    "component_inputs",
    "components",
    "recipe_versions",
    "recipes",
    "profile",
  ]) {
    const spec = TABLE_BY_NAME.get(table);
    if (!spec) continue;
    db.exec(spec.where ? `DELETE FROM ${table} WHERE ${spec.where}` : `DELETE FROM ${table}`);
  }
  if (present.has("people")) db.exec("DELETE FROM people");
  if (present.has("households")) db.exec("DELETE FROM households");
  db.exec("DELETE FROM retention_factors WHERE origin = 'user'");
  const keys = [...IMPORTABLE_SETTINGS];
  if (keys.length > 0) {
    db.prepare(
      `DELETE FROM app_settings WHERE key IN (${keys.map(() => "?").join(", ")})`,
    ).run(...keys);
  }
  if (present.has("ai_calls")) db.exec("DELETE FROM ai_calls");
}

export function applyArchive(
  parsed: ParsedArchive,
  options: ApplyOptions = { mode: "merge" },
): ImportReport {
  const mode = options.mode;
  const dryRun = options.dryRun ?? false;
  const warnings = [...parsed.warnings];
  const report: TableReport[] = [];
  const isV1 = parsed.manifest.formatVersion === 1;
  const scope: ArchiveScope = isV1 ? "person" : parsed.manifest.scope;

  assertScopeShape(parsed);

  if (isV1 && mode === "replace") {
    const people = (
      db.prepare("SELECT COUNT(*) AS n FROM people").get() as unknown as { n: number }
    ).n;
    if (people !== 1) {
      fail(
        "This archive predates household support. Merge it, or restore it on a single-person installation.",
      );
    }
  }

  const currentHousehold = getHousehold();
  const person = scope === "person" ? resolvePersonTarget(parsed, options) : null;

  if (isV1 && person) {
    normaliseLegacySettings(parsed, person.id, warnings);
  }

  const prepared = prepareTables(parsed, scope, mode, person, currentHousehold.id);
  const present = new Set(prepared.map((table) => table.spec.table));
  const ordered = tablesForImport(present);

  let written = 0;
  let skipped = 0;
  // Files created by this import. If the transaction rolls back, they are
  // removed so a failed import leaves no half-restored evidence behind.
  const createdFiles: string[] = [];
  // Captured foods inserted by this import. Evidence rewrite-by-value is
  // restricted to these ids, so a person-scope import cannot repoint another
  // person's shared row.
  const insertedFoodIds = new Set<string>();

  db.exec("BEGIN IMMEDIATE");
  try {
    if (person?.needsRow) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO people (id, household_id, display_name, created_at, archived_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        person.id,
        currentHousehold.id,
        String(person.source?.display_name ?? "Me"),
        String(person.source?.created_at ?? now),
        person.source?.archived_at == null ? null : String(person.source.archived_at),
      );
    }

    if (mode === "replace") {
      deleteScoped(scope, person, present);
    }

    for (const spec of ordered) {
      const parsedTable = prepared.find((table) => table.spec.table === spec.table);
      if (!parsedTable) continue;

      if (parsedTable.rows.length === 0) {
        // An empty table still appears in the report, and in `replace` mode
        // it was already cleared by the delete step above. There is no
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

      // Shared rows in a person archive are merged even in replace mode. A
      // person replace must never delete the household library.
      const tableMode: ImportMode =
        mode === "replace" && scope === "person" && spec.scope === "shared"
          ? "merge"
          : mode;

      let added = 0;
      let kept = 0;
      let conflicts = 0;

      for (let rowIndex = 0; rowIndex < parsedTable.rows.length; rowIndex += 1) {
        const row = parsedTable.rows[rowIndex];
        const rowColumns = candidateColumns.filter((column) => column in row);
        const values = rowColumns.map(
          (column) => (row[column] ?? null) as string | number | null,
        );

        if (tableMode === "merge") {
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
          if (spec.table === "captured_foods" && row.id != null) {
            insertedFoodIds.add(String(row.id));
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          // Merge never overwrites. A row that collides on a unique field
          // (for example a plan for the same week under a different id) is
          // a conflict to report, not a row to drop silently.
          if (tableMode === "merge" && /UNIQUE constraint failed/i.test(detail)) {
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
      const rewrite = insertedFoodIds.size
        ? db.prepare(
            `UPDATE captured_foods SET image_path = ?
              WHERE image_path = ? AND id IN (${[...insertedFoodIds].map(() => "?").join(", ")})`,
          )
        : null;

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

        if (!rewrite) {
          warnings.push(
            `Evidence image "${name}" already exists with different content; ` +
              "the existing file was kept.",
          );
          skipped += 1;
          continue;
        }

        // Write the archive's bytes under a new name and repoint only the
        // captured foods this import inserted. Existing shared rows keep
        // their image, which is what makes a person import safe.
        const renamed = uniqueEvidenceName(dir, name);
        target = path.join(dir, renamed);
        writeFileSync(target, data, { mode: PRIVATE_FILE_MODE, flag: "wx" });
        createdFiles.push(target);
        rewrite.run(`data/evidence/${renamed}`, `data/evidence/${name}`, ...insertedFoodIds);
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
    scope,
    personId: person?.id ?? null,
    appVersion: parsed.manifest.appVersion,
    exportedAt: parsed.manifest.exportedAt,
    tables: report,
    files: { written, skipped },
    warnings,
  };
}

/** Convenience: parse and apply in one call. */
export function importArchive(buffer: Buffer, options: ApplyOptions): ImportReport {
  return applyArchive(parseArchive(buffer), options);
}
