import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Key handling is the highest-value target in a local-first app: a stored key
 * is real money and a real credential. The host binding is the control that
 * stops a changed `baseUrl` from exfiltrating it.
 */

let dir: string;
let secrets: typeof import("@/lib/ai/secrets");

function secretsFile(): string {
  return path.join(dir, "secrets.json");
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-secrets-"));
  process.env.NUTRIPLAN_DATA_DIR = dir;
  secrets = await import("@/lib/ai/secrets");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(secretsFile(), { force: true });
});

afterAll(() => {
  delete process.env.NUTRIPLAN_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("host-bound keys", () => {
  it("releases a file key only for the host it was entered for", () => {
    secrets.setKey("openai", "sk-a", "API.Example.com");
    expect(secrets.getKeyForHost("openai", "api.example.com")).toBe("sk-a");
    expect(secrets.getKeyForHost("openai", "evil.example")).toBeNull();
    // A fixed, provider-owned endpoint still uses getKey.
    expect(secrets.getKey("openai")).toBe("sk-a");
  });

  it("refuses an unbound file key for a caller-supplied host", () => {
    secrets.setKey("openai", "sk-a");
    expect(secrets.getKeyForHost("openai", "api.example.com")).toBeNull();
    expect(secrets.getKey("openai")).toBe("sk-a");
  });

  it("clears both the key and its binding on removal", () => {
    secrets.setKey("openai", "sk-a", "api.example.com");
    secrets.setKey("openai", null);
    expect(secrets.getKey("openai")).toBeNull();
    expect(secrets.boundHostFor("openai")).toBeNull();
  });

  it("treats an env key as operator-controlled and unbound", () => {
    vi.stubEnv("NUTRIPLAN_AI_OPENAI_KEY", "env-key");
    expect(secrets.getKeyForHost("openai", "any.example")).toBe("env-key");
    expect(secrets.getKey("openai")).toBe("env-key");
  });

  it("reports a conflict when both an env key and a file key exist", () => {
    secrets.setKey("openai", "file-key", "api.example.com");
    vi.stubEnv("NUTRIPLAN_AI_OPENAI_KEY", "env-key");
    expect(() => secrets.getKey("openai")).toThrow(/Both .* define a key/);
  });

  it("refuses to overwrite an env-provided key", () => {
    vi.stubEnv("NUTRIPLAN_AI_OPENAI_KEY", "env-key");
    expect(() => secrets.setKey("openai", "file-key")).toThrow(/env-provided/);
  });

  it("reads the legacy flat shape but treats it as unbound", () => {
    writeFileSync(secretsFile(), JSON.stringify({ openai: "sk-legacy" }));
    expect(secrets.getKey("openai")).toBe("sk-legacy");
    expect(secrets.getKeyForHost("openai", "api.example.com")).toBeNull();
  });
});
