import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Persistence test.
 *
 * Points the database at a throwaway file so the dev database is never
 * touched. This covers the contract the server action relies on: what is
 * written is what comes back, and the resolved gram weight is stored
 * rather than re-derived later.
 */
let dir: string;
let personId: string;
let repo: typeof import("@/lib/db/entries");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-test-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  repo = await import("@/lib/db/entries");
  personId = (await import("@/lib/db/people")).defaultPersonId();
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("entries repository", () => {
  it("stores and reads back an entry", () => {
    const entry = repo.addEntry(personId, {
      foodId: "paneer",
      grams: 100,
      amount: 1,
      unit: "portion:1 katori",
      day: "2026-11-14",
    });

    const entries = repo.listEntries(personId, "2026-11-14");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: entry.id,
      foodId: "paneer",
      grams: 100,
      amount: 1,
      unit: "portion:1 katori",
    });
  });

  it("keeps days separate", () => {
    repo.addEntry(personId, {
      foodId: "egg",
      grams: 50,
      amount: 1,
      unit: "portion:1 large",
      day: "2026-11-15",
    });

    expect(repo.listEntries(personId, "2026-11-14")).toHaveLength(1);
    expect(repo.listEntries(personId, "2026-11-15")).toHaveLength(1);
  });

  it("removes an entry", () => {
    const entries = repo.listEntries(personId, "2026-11-14");
    repo.removeEntry(personId, entries[0].id);
    expect(repo.listEntries(personId, "2026-11-14")).toHaveLength(0);
  });

  it("returns today as a local calendar day", () => {
    expect(repo.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
