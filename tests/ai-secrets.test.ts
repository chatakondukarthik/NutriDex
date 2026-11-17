import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    // A key entered for a custom host is not released to the provider's own
    // fixed endpoint: that would be the same host change, in reverse.
    expect(secrets.getKey("openai")).toBeNull();
  });

  it("keeps a separate binding per host so roles do not clobber each other", () => {
    secrets.setKey("openai", "primary-key", "api.primary.test");
    secrets.setKey("openai", "image-key", "api.image.test");
    expect(secrets.getKeyForHost("openai", "api.primary.test")).toBe("primary-key");
    expect(secrets.getKeyForHost("openai", "api.image.test")).toBe("image-key");
    // Saving the second host must not drop the first.
    secrets.setKey("openai", "image-key-2", "api.image.test");
    expect(secrets.getKeyForHost("openai", "api.primary.test")).toBe("primary-key");
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

  it("does not release an unpinned env key to a caller-supplied host", () => {
    vi.stubEnv("NUTRIPLAN_AI_OPENAI_KEY", "env-key");
    expect(secrets.getKeyForHost("openai", "any.example")).toBeNull();
    // A fixed provider endpoint is unaffected.
    expect(secrets.getKey("openai")).toBe("env-key");
  });

  it("releases an env key only to a host pinned with NUTRIPLAN_AI_<P>_HOST", () => {
    vi.stubEnv("NUTRIPLAN_AI_OPENAI_KEY", "env-key");
    vi.stubEnv("NUTRIPLAN_AI_OPENAI_HOST", "api.allowed.test, api.second.test");
    expect(secrets.getKeyForHost("openai", "api.allowed.test")).toBe("env-key");
    expect(secrets.getKeyForHost("openai", "API.SECOND.TEST")).toBe("env-key");
    expect(secrets.getKeyForHost("openai", "evil.example")).toBeNull();
  });

  it("reports a conflict when both an env key and a fixed file key exist", () => {
    secrets.setKey("openai", "file-key");
    vi.stubEnv("NUTRIPLAN_AI_OPENAI_KEY", "env-key");
    expect(() => secrets.getKey("openai")).toThrow(/Both .* define a key/);
  });

  it("reports a conflict when an env key and a bound file key both exist", () => {
    secrets.setKey("openai", "file-key", "api.example.com");
    vi.stubEnv("NUTRIPLAN_AI_OPENAI_KEY", "env-key");
    expect(() => secrets.getKeyForHost("openai", "api.example.com")).toThrow(
      /Both .* define a key/,
    );
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

  it("reads the committed single-host shape for the same host only", () => {
    writeFileSync(
      secretsFile(),
      JSON.stringify({ keys: { openai: "sk-old" }, hosts: { openai: "api.example.com" } }),
    );
    expect(secrets.getKeyForHost("openai", "api.example.com")).toBe("sk-old");
    expect(secrets.getKeyForHost("openai", "evil.example")).toBeNull();
    // The flat key was entered for `api.example.com`, so it is not a
    // fixed-endpoint key either.
    expect(secrets.getKey("openai")).toBeNull();
    // Rewriting the same host migrates it to the composite shape.
    secrets.setKey("openai", "sk-new", "api.example.com");
    const raw = JSON.parse(readFileSync(secretsFile(), "utf8"));
    expect(raw.keys["openai@api.example.com"]).toBe("sk-new");
    expect(raw.hosts.openai).toBeUndefined();
  });
});
