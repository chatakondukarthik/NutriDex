import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Keys live in `data/secrets.json` (mode 0600) or in env vars
 * `NUTRIPLAN_AI_<PROVIDER>_KEY`. Env wins, but both set is an error.
 */

function secretsPath(): string {
  return path.join(process.cwd(), "data", "secrets.json");
}

export function envKeyFor(provider: string): string {
  return `NUTRIPLAN_AI_${provider.toUpperCase().replace(/-/g, "_")}_KEY`;
}

export function readSecrets(): Record<string, string> {
  const p = secretsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function getKey(provider: string): string | null {
  const envName = envKeyFor(provider);
  const envValue = process.env[envName];
  const fileValue = readSecrets()[provider];
  if (envValue && fileValue) {
    throw new Error(
      `Both ${envName} and data/secrets.json define a key for ${provider}. Remove one.`,
    );
  }
  return envValue ?? fileValue ?? null;
}

export function setKey(provider: string, key: string | null): void {
  const envName = envKeyFor(provider);
  if (process.env[envName]) {
    throw new Error(`Cannot overwrite an env-provided key (${envName}).`);
  }
  const secrets = readSecrets();
  if (key == null || key.trim() === "") {
    delete secrets[provider];
  } else {
    secrets[provider] = key.trim();
  }
  mkdirSync(path.dirname(secretsPath()), { recursive: true });
  writeFileSync(secretsPath(), JSON.stringify(secrets, null, 2), { mode: 0o600 });
  try {
    chmodSync(secretsPath(), 0o600);
  } catch {
    /* best effort */
  }
}

export function hasKey(provider: string): boolean {
  try {
    return !!getKey(provider);
  } catch {
    return false;
  }
}
