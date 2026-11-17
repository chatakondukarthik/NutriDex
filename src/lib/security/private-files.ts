/**
 * Private on-disk state: directories at `0700`, files at `0600`, writes
 * that cannot be left half-finished.
 *
 * The SQLite file, `secrets.json` and `ai-config.json` live next to each
 * other under `NUTRIPLAN_DATA_DIR`. Without an explicit mode they inherit
 * the process umask (usually `022`), which makes a health diary and the
 * stored AI key readable by every local account. `secrets.json` already
 * asked for `0600`, but a crash during `writeFileSync` could truncate it
 * and lose every key, so the write is now temp-file + fsync + rename.
 */

import {
  chmodSync,
  closeSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Create `dir` if needed and make it owner-only. Best effort on chmod. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  try {
    chmodSync(dir, PRIVATE_DIR_MODE);
  } catch {
    /* best effort: a read-only or network filesystem may refuse */
  }
}

/** Tighten an existing file. Best effort: SQLite may hold the handle open. */
export function restrictFile(file: string): void {
  try {
    chmodSync(file, PRIVATE_FILE_MODE);
  } catch {
    /* best effort */
  }
}

/**
 * Write `data` to `file` atomically and owner-only.
 *
 * `openSync`'s mode is filtered by the umask, so `fchmodSync` sets the real
 * mode on the descriptor before anything is renamed into place. A reader
 * therefore never observes a `0644` window, and a crash leaves the previous
 * file intact.
 */
export function atomicWritePrivateFile(file: string, data: string): void {
  const dir = path.dirname(file);
  ensurePrivateDir(dir);

  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );

  const fd = openSync(tmp, "w", PRIVATE_FILE_MODE);
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE);
    writeSync(fd, data);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    // Do not leave a half-written temp file (or the data it contains)
    // behind when the write fails.
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw error;
  }
  closeSync(fd);

  renameSync(tmp, file);
  restrictFile(file);

  // Make the rename itself durable: fsync the directory so a power loss
  // cannot leave the old file in place after we reported success.
  try {
    const dirFd = openSync(dir, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    /* best effort: some filesystems refuse to fsync a directory */
  }
}
