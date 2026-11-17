import path from "node:path";
import { ensurePrivateDir } from "@/lib/security/private-files";

/**
 * One place that decides where writable state lives: the SQLite file, the
 * saved API keys, and the AI config.
 *
 * In development that is `./data`, which `.gitignore` already excludes. A
 * deployment mounts one volume and points `NUTRIPLAN_DATA_DIR` at it, so
 * the database and keys survive a rebuild — with `output: "standalone"`
 * the process cwd is `.next/standalone`, and writing relative to cwd there
 * would put the data inside the build output.
 */
export function dataDir(): string {
  const raw = process.env.NUTRIPLAN_DATA_DIR?.trim();
  return raw ? path.resolve(raw) : path.join(process.cwd(), "data");
}

export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}

/**
 * Resolve the data directory and make it owner-only before anything is
 * written into it. Called by the database and the two JSON stores on boot;
 * idempotent and cheap.
 */
export function ensureDataDir(): string {
  const dir = dataDir();
  ensurePrivateDir(dir);
  return dir;
}
