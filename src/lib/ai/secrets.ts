import { readFileSync, existsSync } from "node:fs";
import { dataFile } from "@/lib/data-dir";
import { atomicWritePrivateFile } from "@/lib/security/private-files";

/**
 * Keys live in `data/secrets.json` (mode 0600) or in env vars
 * `NUTRIPLAN_AI_<PROVIDER>_KEY`. Env wins, but both set is an error.
 *
 * ## Why a key is bound to a host
 *
 * The AI layer posts a stored key to a user-supplied `baseUrl`. Without a
 * binding, changing the base URL to an attacker's host and pressing "test
 * connection" sends the key there. The file therefore records the host each
 * key was entered for; a custom base URL only receives a key whose recorded
 * host matches. Changing the host means re-entering the key, which is the
 * confirmation step that turns silent exfiltration into a visible action.
 *
 * Env-provided keys are operator-controlled and are not bound: the operator
 * already chose the deployment's endpoints.
 *
 * File shape (the flat legacy shape is still read):
 *   { "keys": { "openai": "sk-…" }, "hosts": { "openai": "api.openai.com" } }
 */

interface SecretsFile {
  keys: Record<string, string>;
  hosts: Record<string, string>;
}

function secretsPath(): string {
  return dataFile("secrets.json");
}

export function envKeyFor(provider: string): string {
  return `NUTRIPLAN_AI_${provider.toUpperCase().replace(/-/g, "_")}_KEY`;
}

function normalize(raw: unknown): SecretsFile {
  if (!raw || typeof raw !== "object") return { keys: {}, hosts: {} };
  const obj = raw as Record<string, unknown>;

  // New shape.
  if (obj.keys && typeof obj.keys === "object") {
    const keys: Record<string, string> = {};
    const hosts: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.keys as Record<string, unknown>)) {
      if (typeof v === "string") keys[k] = v;
    }
    if (obj.hosts && typeof obj.hosts === "object") {
      for (const [k, v] of Object.entries(obj.hosts as Record<string, unknown>)) {
        if (typeof v === "string") hosts[k] = v.toLowerCase();
      }
    }
    return { keys, hosts };
  }

  // Legacy flat shape: `{ "openai": "sk-…" }`.
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") keys[k] = v;
  }
  return { keys, hosts: {} };
}

function readSecretsFile(): SecretsFile {
  const p = secretsPath();
  if (!existsSync(p)) return { keys: {}, hosts: {} };
  try {
    return normalize(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return { keys: {}, hosts: {} };
  }
}

/** Keys only, for callers that do not need the host binding. */
export function readSecrets(): Record<string, string> {
  return readSecretsFile().keys;
}

/** The host a stored key was entered for, or null when unbound. */
export function boundHostFor(provider: string): string | null {
  return readSecretsFile().hosts[provider] ?? null;
}

function resolveKey(provider: string): { value: string; fromEnv: boolean } | null {
  const envName = envKeyFor(provider);
  const envValue = process.env[envName];
  const fileValue = readSecretsFile().keys[provider];
  if (envValue && fileValue) {
    throw new Error(
      `Both ${envName} and data/secrets.json define a key for ${provider}. Remove one.`,
    );
  }
  if (envValue) return { value: envValue, fromEnv: true };
  if (fileValue) return { value: fileValue, fromEnv: false };
  return null;
}

/** A key for a fixed, provider-owned endpoint (no host binding needed). */
export function getKey(provider: string): string | null {
  return resolveKey(provider)?.value ?? null;
}

/**
 * A key for a caller-supplied base URL.
 *
 * Env keys are returned as-is. A file key is returned only when it was
 * entered for this exact host. An unbound file key is refused rather than
 * guessed: the safe failure is "re-enter your key", not "send it anyway".
 */
export function getKeyForHost(provider: string, host: string): string | null {
  const resolved = resolveKey(provider);
  if (!resolved) return null;
  if (resolved.fromEnv) return resolved.value;

  const bound = readSecretsFile().hosts[provider];
  if (!bound) return null;
  return bound === host.toLowerCase() ? resolved.value : null;
}

export function setKey(provider: string, key: string | null, host?: string | null): void {
  const envName = envKeyFor(provider);
  if (process.env[envName]) {
    throw new Error(`Cannot overwrite an env-provided key (${envName}).`);
  }

  const secrets = readSecretsFile();
  if (key == null || key.trim() === "") {
    delete secrets.keys[provider];
    delete secrets.hosts[provider];
  } else {
    secrets.keys[provider] = key.trim();
    if (host && host.trim()) {
      secrets.hosts[provider] = host.trim().toLowerCase();
    } else {
      delete secrets.hosts[provider];
    }
  }

  // Atomic, `0600`, and crash-safe: the old file survives a failed write.
  atomicWritePrivateFile(secretsPath(), JSON.stringify(secrets, null, 2));
}

export function hasKey(provider: string): boolean {
  try {
    return !!getKey(provider);
  } catch {
    return false;
  }
}
