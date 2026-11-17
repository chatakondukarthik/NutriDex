import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  atomicWritePrivateFile,
  ensurePrivateDir,
  restrictFile,
} from "@/lib/security/private-files";

/**
 * The OS account is the real boundary, and these modes are what make it
 * hold: a `0644` diary or `secrets.json` is readable by every local account.
 */

let root: string;

function mode(file: string): number {
  return statSync(file).mode & 0o777;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "nutriplan-files-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ensurePrivateDir", () => {
  it("creates a new directory owner-only", () => {
    const dir = path.join(root, "data");
    ensurePrivateDir(dir);
    expect(mode(dir)).toBe(0o700);
  });

  it("tightens an existing permissive directory", () => {
    const dir = path.join(root, "shared");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    ensurePrivateDir(dir);
    expect(mode(dir)).toBe(0o700);
  });
});

describe("restrictFile", () => {
  it("tightens an existing permissive file", () => {
    const file = path.join(root, "old.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o644);
    restrictFile(file);
    expect(mode(file)).toBe(0o600);
  });
});

describe("atomicWritePrivateFile", () => {
  it("writes content with owner-only mode and no readable temp window", () => {
    const file = path.join(root, "data", "secrets.json");
    atomicWritePrivateFile(file, '{"openai":"sk-test"}');

    expect(mode(path.dirname(file))).toBe(0o700);
    expect(mode(file)).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe('{"openai":"sk-test"}');
  });

  it("replaces an existing file without leaving a temp file behind", () => {
    const dir = path.join(root, "data");
    const file = path.join(dir, "ai-config.json");
    atomicWritePrivateFile(file, '{"v":1}');
    atomicWritePrivateFile(file, '{"v":2}');

    expect(readFileSync(file, "utf8")).toBe('{"v":2}');
    expect(readdirSync(dir)).toEqual(["ai-config.json"]);
  });
});
