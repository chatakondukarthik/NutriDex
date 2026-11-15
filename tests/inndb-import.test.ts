import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importInndb, DEFAULT_INNDB_MAPPING } from "@/lib/importer/inndb";
import { listCapturedFoods } from "@/lib/db/foods";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let dir: string;
let dbMod: typeof import("@/lib/db/client");

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-inndb-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  dbMod = await import("@/lib/db/client");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  dbMod.db.exec("DELETE FROM captured_food_portions; DELETE FROM captured_food_nutrients; DELETE FROM captured_foods;");
});

describe("INDB importer", () => {
  it("imports rows and skips duplicates", () => {
    const csv = readFileSync("/tmp/sample_inndb.csv", "utf8");
    const r1 = importInndb(csv, DEFAULT_INNDB_MAPPING);
    expect(r1.imported).toBe(3);
    expect(r1.skipped).toBe(0);
    // re-import skips
    const r2 = importInndb(csv, DEFAULT_INNDB_MAPPING);
    expect(r2.imported).toBe(0);
    expect(r2.skipped).toBe(3);
  });

  it("maps nutrients correctly", () => {
    const csv = readFileSync("/tmp/sample_inndb.csv", "utf8");
    importInndb(csv, DEFAULT_INNDB_MAPPING);
    const foods = listCapturedFoods();
    const paneer = foods.find((f: any) => f.name === "Paneer (homemade)")!;
    expect(paneer).toBeDefined();
    expect(paneer.nutrients.ENERC_KCAL.amount).toBe(265);
    expect(paneer.nutrients.PROCNT.amount).toBe(18.3);
  });
});
