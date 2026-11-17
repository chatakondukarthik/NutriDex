import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { db } from "@/lib/db/client";
import { getMeta } from "@/lib/db/meta";
import { dataFile, ensureDataDir } from "@/lib/data-dir";
import { restrictFile } from "@/lib/security/private-files";
import {
  APP_VERSION,
  type ArchiveManifest,
  type ManifestFile,
  FILES_DIR,
  MANIFEST_PATH,
  README_PATH,
  SNAPSHOT_PATH,
  dataPath,
} from "./manifest";
import { ARCHIVE_FORMAT, ARCHIVE_FORMAT_VERSION, tablesForExport } from "./registry";
import { columnsOf } from "./schema";
import { type ZipEntryInput, writeZip } from "./zip";

/**
 * Build the archive.
 *
 * Three things make this "total" rather than "most of it":
 *
 *   1. every table in the registry is exported, and columns come from the
 *      live schema, so a new column cannot be forgotten;
 *   2. evidence files referenced by exported rows are copied into `files/`;
 *   3. the manifest records a SHA-256 for every entry, so an import can
 *      prove it read the archive the user exported.
 *
 * A `snapshot.sqlite` produced by `VACUUM INTO` is included by default. It
 * is not the interchange format — the NDJSON is — but it is a complete,
 * consistent copy for disaster recovery if this code is ever wrong.
 */

export type ExportOptions = {
  /** Include the AI activity log. Off by default: it is operational, not content. */
  includeAiCalls?: boolean;
  /** Include `snapshot.sqlite`. On by default. */
  includeSnapshot?: boolean;
  now?: Date;
};

export type ExportResult = {
  buffer: Buffer;
  manifest: ArchiveManifest;
};

const EVIDENCE_PREFIX = "data/evidence/";

/** `image_path` values that point at a local evidence file we should copy. */
function evidenceName(imagePath: unknown): string | null {
  if (typeof imagePath !== "string" || !imagePath.startsWith(EVIDENCE_PREFIX)) return null;
  const name = imagePath.slice(EVIDENCE_PREFIX.length);
  // One path segment, no separators: the archive layout is flat.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) return null;
  return name;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function ndjson(rows: Array<Record<string, unknown>>): Buffer {
  if (rows.length === 0) return Buffer.alloc(0);
  return Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

/**
 * A consistent, vacuumed copy of the database with derived state removed.
 *
 * `VACUUM INTO` takes a read snapshot, so the app can keep serving requests
 * while it runs. The copy is then opened to delete the estimate cache (pure
 * derivation) and — unless the caller asked for it — the AI log, so the
 * snapshot and the NDJSON describe the same content.
 */
function buildSnapshot(includeAiCalls: boolean): Buffer {
  ensureDataDir();
  const tmp = dataFile(`.snapshot-${randomUUID()}.sqlite`);
  try {
    // The path is generated above and cannot contain a quote.
    db.exec(`VACUUM INTO '${tmp}'`);
    restrictFile(tmp);

    const copy = new DatabaseSync(tmp);
    try {
      copy.exec("DELETE FROM estimate_cache");
      if (!includeAiCalls) copy.exec("DELETE FROM ai_calls");
      copy.exec("VACUUM");
    } finally {
      copy.close();
    }

    return readFileSync(tmp);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* the temp file may not exist if VACUUM failed */
    }
  }
}

const README = `NutriPlan archive
=================

This ZIP is a complete copy of one NutriPlan installation.

  manifest.json   Format version, row counts, and a SHA-256 for every file.
  data/*.ndjson   One JSON object per line, one file per table.
  files/          Evidence images referenced by the rows.
  snapshot.sqlite A full database snapshot (optional, for recovery).

Restore it from Settings -> Data -> Import. Keep this file private: it
contains your profile, diary and recipes. It does not contain AI API keys.

The NDJSON files are the interchange format and are readable with any text
editor. The snapshot is a convenience copy; the importer does not use it.
`;

export function buildArchive(options: ExportOptions = {}): ExportResult {
  const now = options.now ?? new Date();
  const includeAiCalls = options.includeAiCalls ?? false;
  const includeSnapshot = options.includeSnapshot ?? true;

  const entries: ZipEntryInput[] = [];
  const files: ManifestFile[] = [];
  const counts: Record<string, number> = {};
  const columns: Record<string, string[]> = {};
  const warnings: string[] = [];

  const add = (path: string, data: Buffer, compress?: boolean) => {
    entries.push({ name: path, data, compress });
    files.push({ path, sha256: sha256(data), bytes: data.length });
  };

  // Two captured foods can legitimately share one photo, and `writeZip`
  // refuses duplicate names. Copy each evidence file once.
  const copiedEvidence = new Set<string>();

  for (const spec of tablesForExport({ includeAiCalls })) {
    const columnInfo = columnsOf(db, spec.table);
    const exported = columnInfo
      .map((column) => column.name)
      .filter((name) => !spec.omit?.includes(name));

    const where = spec.where ? ` WHERE ${spec.where}` : "";
    const rows = db
      .prepare(`SELECT ${exported.join(", ")} FROM ${spec.table}${where}`)
      .all() as unknown as Array<Record<string, unknown>>;

    counts[spec.table] = rows.length;
    columns[spec.table] = exported;
    add(dataPath(spec.table), ndjson(rows));

    // Copy any local evidence the rows point at. A missing file is a
    // warning, not a failure: the archive is still useful without it.
    if (spec.table === "captured_foods") {
      for (const row of rows) {
        const name = evidenceName(row.image_path);
        if (!name || copiedEvidence.has(name)) continue;
        copiedEvidence.add(name);
        const source = dataFile(`evidence/${name}`);
        if (!existsSync(source)) {
          warnings.push(`Evidence image missing on disk: data/evidence/${name}`);
          continue;
        }
        add(`${FILES_DIR}evidence/${name}`, readFileSync(source), false);
      }
    }
  }

  if (includeSnapshot) {
    add(SNAPSHOT_PATH, buildSnapshot(includeAiCalls), false);
  }

  add(README_PATH, Buffer.from(README, "utf8"));

  // Export is a read. `created_at` is written once when the database is
  // opened (see `db/client.ts`), so this path never mutates the database —
  // which is why `GET /api/export` is safe to treat as a read.
  const createdAt = getMeta("created_at") ?? now.toISOString();

  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    appVersion: APP_VERSION,
    createdAt,
    exportedAt: now.toISOString(),
    accountId: getMeta("account_id"),
    counts,
    columns,
    files,
    includes: {
      aiCalls: includeAiCalls,
      snapshot: includeSnapshot,
      secrets: false,
    },
    warnings,
  };

  // The manifest is added last so it can describe every other entry. It is
  // deliberately absent from `files`: a checksum cannot cover itself.
  entries.unshift({
    name: MANIFEST_PATH,
    data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"),
  });

  return { buffer: writeZip(entries, now), manifest };
}

/** Exposed for tests. */
export function archiveFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `nutriplan-${stamp}Z.zip`;
}
