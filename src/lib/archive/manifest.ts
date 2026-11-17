import { ARCHIVE_FORMAT, ARCHIVE_FORMAT_VERSION } from "./registry";

/**
 * `manifest.json` is the archive's contract with the future.
 *
 * It is the first thing an importer reads and the only file it trusts before
 * checksums are verified. Everything in it is validated, nothing in it is
 * executed.
 */

export type ManifestFile = {
  path: string;
  sha256: string;
  bytes: number;
};

export type ArchiveManifest = {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  appVersion: string;
  /** When this installation first created its database. */
  createdAt: string;
  exportedAt: string;
  accountId: string | null;
  counts: Record<string, number>;
  columns: Record<string, string[]>;
  files: ManifestFile[];
  includes: {
    aiCalls: boolean;
    snapshot: boolean;
    /** Always false. Present so a reader can assert it. */
    secrets: false;
  };
  warnings: string[];
};

/** Bumped by hand when the app's package version changes. */
export const APP_VERSION = "0.1.0";

export const MANIFEST_PATH = "manifest.json";
export const DATA_DIR = "data/";
export const FILES_DIR = "files/";
export const SNAPSHOT_PATH = "snapshot.sqlite";
export const README_PATH = "README.txt";

export function dataPath(table: string): string {
  return `${DATA_DIR}${table}.ndjson`;
}

export function tableFromDataPath(path: string): string | null {
  if (!path.startsWith(DATA_DIR) || !path.endsWith(".ndjson")) return null;
  return path.slice(DATA_DIR.length, -".ndjson".length);
}

export function isSupportedFormat(manifest: ArchiveManifest): boolean {
  return (
    manifest.format === ARCHIVE_FORMAT &&
    Number.isInteger(manifest.formatVersion) &&
    manifest.formatVersion >= 1 &&
    manifest.formatVersion <= ARCHIVE_FORMAT_VERSION
  );
}
