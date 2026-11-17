import { db } from "./client";

/**
 * Archive and identity metadata.
 *
 * Deliberately separate from `app_settings`: settings are user content and
 * travel in an export, while these values describe *this installation* and
 * must not be overwritten by an import. `account_id` is the only value that
 * can ever point at an online identity, and it is an opaque UUID — never an
 * email, a name or anything a provider chose.
 */

export const META_KEYS = ["account_id", "created_at"] as const;

export type MetaKey = (typeof META_KEYS)[number];

const ALLOWED = new Set<string>(META_KEYS);

export function getMeta(key: MetaKey): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as unknown as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: MetaKey, value: string): void {
  // The key is interpolated nowhere; it is bound. The allowlist exists so a
  // caller cannot park arbitrary state in a table the archive treats as
  // authoritative.
  if (!ALLOWED.has(key)) throw new Error(`Unknown meta key "${key}".`);
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function deleteMeta(key: MetaKey): void {
  if (!ALLOWED.has(key)) throw new Error(`Unknown meta key "${key}".`);
  db.prepare("DELETE FROM meta WHERE key = ?").run(key);
}
