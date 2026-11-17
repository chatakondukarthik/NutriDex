import { readFileSync, existsSync } from "node:fs";
import { dataFile, ensureDataDir } from "@/lib/data-dir";
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
 * ## Env keys are bound too
 *
 * An env key is not automatically safe: `baseUrl` is caller-controlled by
 * any server action, so "the operator chose the endpoint" only holds if the
 * operator also pins the host. `NUTRIPLAN_AI_<PROVIDER>_HOST` (comma
 * separated) is that pin. Without it, an env key is never released to a
 * custom endpoint — the call fails closed with "re-enter the key". Fixed
 * provider endpoints (`api.openai.com`, Gemini, Anthropic) still use
 * `getKey` and are unaffected.
 *
 * ## One provider, several hosts
 *
 * A provider can appear in more than one role (primary, fallback, image),
 * each with a different `baseUrl`. Bound keys are therefore stored per
 * `provider@host`, not per provider, so saving the image endpoint no longer
 * overwrites the primary key or drops its binding.
 *
 * File shape (older shapes are still read):
 *   {
 *     "keys": {
 *       "openai": "sk-…",                       // fixed endpoint
 *       "openai@api.example.com": "sk-…"        // bound to a host
 *     },
 *     "hosts": { "openai": "api.example.com" }  // committed legacy shape
 *   }
 */

interface SecretsFile {
  keys: Record<string, string>;
  /** Legacy (pre-multi-host) binding map. Read only; never written now. */
  hosts: Record<string, string>;
}

function secretsPath(): string {
  return dataFile("secrets.json");
}

export function envKeyFor(provider: string): string {
  return `NUTRIPLAN_AI_${provider.toUpperCase().replace(/-/g, "_")}_KEY`;
}

/** Hosts an env-provided key may be sent to. Empty means "fixed endpoints only". */
export function envHostFor(provider: string): string[] {
  const name = `NUTRIPLAN_AI_${provider.toUpperCase().replace(/-/g, "_")}_HOST`;
  return String(process.env[name] ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/** `provider@host` — the storage key for a host-bound secret. */
function boundKey(provider: string, host: string): string {
  return `${provider}@${host.toLowerCase()}`;
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
  ensureDataDir();
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

/**
 * The host a stored key was entered for, or null when unbound.
 *
 * With several bindings this returns the first one; the UI only needs to
 * know whether *a* host is recorded.
 */
export function boundHostFor(provider: string): string | null {
  const secrets = readSecretsFile();
  if (secrets.hosts[provider]) return secrets.hosts[provider];
  const prefix = `${provider}@`;
  const found = Object.keys(secrets.keys).find((key) => key.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function resolveKey(provider: string): { value: string; fromEnv: boolean } | null {
  const envName = envKeyFor(provider);
  const envValue = process.env[envName];
  const secrets = readSecretsFile();
  const fileValue = secrets.keys[provider];
  if (envValue && fileValue) {
    throw new Error(
      `Both ${envName} and data/secrets.json define a key for ${provider}. Remove one.`,
    );
  }
  if (envValue) return { value: envValue, fromEnv: true };
  // A flat key paired with a legacy `hosts[provider]` binding was entered for
  // that host, not for the provider's fixed endpoint. Releasing it to the
  // fixed endpoint would send a key to a host the user never entered it for,
  // so it is treated as bound and refused here (`getKeyForHost` still finds
  // it for the matching host).
  if (fileValue && !secrets.hosts[provider]) return { value: fileValue, fromEnv: false };
  return null;
}

/** A key for a fixed, provider-owned endpoint (no host binding needed). */
export function getKey(provider: string): string | null {
  return resolveKey(provider)?.value ?? null;
}

/**
 * The file key entered for this exact host, including the committed legacy
 * shape (`keys[provider]` + `hosts[provider]`). Null when unbound.
 */
function fileKeyForHost(secrets: SecretsFile, provider: string, host: string): string | null {
  const normalized = host.toLowerCase();
  const composite = secrets.keys[boundKey(provider, normalized)];
  if (composite) return composite;
  if (secrets.hosts[provider] === normalized) return secrets.keys[provider] ?? null;
  return null;
}

/**
 * A key for a caller-supplied base URL.
 *
 * An env key is released only for a host listed in
 * `NUTRIPLAN_AI_<PROVIDER>_HOST`; without that pin it is refused, because
 * the caller — not the operator — chooses the destination. A file key is
 * returned only when it was entered for this exact host. An unbound key is
 * refused rather than guessed: the safe failure is "re-enter your key", not
 * "send it anyway".
 */
export function getKeyForHost(provider: string, host: string): string | null {
  const normalized = host.toLowerCase();
  const envName = envKeyFor(provider);
  const envValue = process.env[envName];
  const secrets = readSecretsFile();
  const fileValue = fileKeyForHost(secrets, provider, normalized);

  if (envValue && (fileValue || secrets.keys[provider])) {
    throw new Error(
      `Both ${envName} and data/secrets.json define a key for ${provider}. Remove one.`,
    );
  }
  if (envValue) {
    return envHostFor(provider).includes(normalized) ? envValue : null;
  }
  return fileValue;
}

export function setKey(provider: string, key: string | null, host?: string | null): void {
  const envName = envKeyFor(provider);
  if (process.env[envName]) {
    throw new Error(`Cannot overwrite an env-provided key (${envName}).`);
  }

  const secrets = readSecretsFile();
  const normalizedHost = host?.trim().toLowerCase();

  if (key == null || key.trim() === "") {
    // Removing a key removes every binding for that provider.
    delete secrets.keys[provider];
    delete secrets.hosts[provider];
    for (const stored of Object.keys(secrets.keys)) {
      if (stored.startsWith(`${provider}@`)) delete secrets.keys[stored];
    }
  } else if (normalizedHost) {
    // Bind to this host without touching a fixed-endpoint key or another
    // role's binding for the same provider.
    secrets.keys[boundKey(provider, normalizedHost)] = key.trim();
    // Migrate the committed single-host shape for this same host.
    if (secrets.hosts[provider] === normalizedHost) {
      delete secrets.keys[provider];
      delete secrets.hosts[provider];
    }
  } else {
    secrets.keys[provider] = key.trim();
    delete secrets.hosts[provider];
  }

  // Atomic, `0600`, and crash-safe: the old file survives a failed write.
  atomicWritePrivateFile(secretsPath(), JSON.stringify(secrets, null, 2));
}

export function hasKey(provider: string): boolean {
  try {
    if (process.env[envKeyFor(provider)]) return true;
    const secrets = readSecretsFile();
    if (secrets.keys[provider]) return true;
    const prefix = `${provider}@`;
    return Object.keys(secrets.keys).some((stored) => stored.startsWith(prefix));
  } catch {
    return false;
  }
}
