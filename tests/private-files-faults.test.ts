import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Fault injection for the atomic writer.
 *
 * The guarantee is "the old file survives a failed write, and no partial
 * temp file is left behind". A successful double-write does not prove that;
 * these cases make `writeSync` short-write and fail, and make `renameSync`
 * fail, at the points where the guarantee matters.
 */

const faults = vi.hoisted(() => ({
  shortWrite: false,
  failAfterBytes: Number.POSITIVE_INFINITY,
  written: 0,
  failRename: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeSync: ((
      fd: number,
      buffer: NodeJS.ArrayBufferView,
      offset?: number | null,
      length?: number | null,
      position?: number | null,
    ) => {
      const off = offset ?? 0;
      const len = length ?? buffer.byteLength - off;

      if (faults.failAfterBytes !== Number.POSITIVE_INFINITY) {
        const remaining = faults.failAfterBytes - faults.written;
        if (remaining <= 0) throw new Error("ENOSPC: no space left on device");
        const wrote = actual.writeSync(fd, buffer, off, Math.min(len, remaining), position ?? null);
        faults.written += wrote;
        return wrote;
      }

      // One byte at a time: exercises the loop that must not rename a
      // partially written file.
      if (faults.shortWrite) {
        return actual.writeSync(fd, buffer, off, Math.min(len, 1), position ?? null);
      }

      return actual.writeSync(fd, buffer, off, len, position ?? null);
    }) as typeof actual.writeSync,
    renameSync: ((from: string, to: string) => {
      if (faults.failRename) throw new Error("EXDEV: cross-device link not permitted");
      return actual.renameSync(from, to);
    }) as typeof actual.renameSync,
  };
});

import { atomicWritePrivateFile } from "@/lib/security/private-files";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "nutriplan-faults-"));
  faults.shortWrite = false;
  faults.failAfterBytes = Number.POSITIVE_INFINITY;
  faults.written = 0;
  faults.failRename = false;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function leftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}

describe("atomicWritePrivateFile under faults", () => {
  it("loops until a short write has written every byte", () => {
    const file = path.join(root, "data", "secrets.json");
    const payload = JSON.stringify({ key: "sk-" + "x".repeat(200) });

    faults.shortWrite = true;
    atomicWritePrivateFile(file, payload);

    expect(readFileSync(file, "utf8")).toBe(payload);
    expect(leftovers(path.dirname(file))).toEqual([]);
  });

  it("keeps the old file when the write fails part-way", () => {
    const dir = path.join(root, "data");
    const file = path.join(dir, "secrets.json");
    atomicWritePrivateFile(file, '{"version":1}');

    // Write 8 bytes, then fail — the temp file is half the new payload.
    faults.failAfterBytes = 8;
    faults.written = 0;
    expect(() => atomicWritePrivateFile(file, '{"version":2,"long":"value"}')).toThrow(/ENOSPC/);

    expect(readFileSync(file, "utf8")).toBe('{"version":1}');
    expect(leftovers(dir)).toEqual([]);
  });

  it("removes the temp file when the rename fails", () => {
    const dir = path.join(root, "data");
    const file = path.join(dir, "ai-config.json");
    atomicWritePrivateFile(file, '{"v":1}');

    faults.failRename = true;
    expect(() => atomicWritePrivateFile(file, '{"v":2}')).toThrow(/EXDEV/);

    expect(readFileSync(file, "utf8")).toBe('{"v":1}');
    expect(leftovers(dir)).toEqual([]);
  });

  it("does not collide when two writes share a millisecond", () => {
    const dir = path.join(root, "data");
    const file = path.join(dir, "secrets.json");
    for (let i = 0; i < 20; i++) atomicWritePrivateFile(file, JSON.stringify({ i }));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ i: 19 });
    expect(leftovers(dir)).toEqual([]);
  });
});
