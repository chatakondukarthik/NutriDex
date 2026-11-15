import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let dir: string;
let dbMod: typeof import("@/lib/db/client");
let importInndb: typeof import("@/lib/importer/inndb")["importInndb"];
let DEFAULT_INNDB_MAPPING: typeof import("@/lib/importer/inndb")["DEFAULT_INNDB_MAPPING"];
let listCapturedFoods: typeof import("@/lib/db/foods")["listCapturedFoods"];

const SAMPLE_INNDB_CSV = `Food name,Food group,Energy (kcal),Protein (g),Fat (g),Carbohydrate (g),Dietary fibre (g),Sodium (mg),Calcium (mg),Iron (mg)
Paneer (homemade),Dairy,265,18.3,20.1,1.2,0,7,208,0.2
Dal (cooked),Legumes,116,9,0.4,20,7.9,2,23,1.5
Roti (wheat),Grains,297,9,1.5,63,10,2,30,3.6
`;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "nutriplan-inndb-"));
  vi.stubEnv("NUTRIPLAN_DB_PATH", path.join(dir, "test.sqlite"));
  dbMod = await import("@/lib/db/client");
  ({ importInndb, DEFAULT_INNDB_MAPPING } = await import("@/lib/importer/inndb"));
  ({ listCapturedFoods } = await import("@/lib/db/foods"));
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
    const csv = SAMPLE_INNDB_CSV;
    const r1 = importInndb(csv, DEFAULT_INNDB_MAPPING);
    expect(r1.imported).toBe(3);
    expect(r1.skipped).toBe(0);
    // re-import skips
    const r2 = importInndb(csv, DEFAULT_INNDB_MAPPING);
    expect(r2.imported).toBe(0);
    expect(r2.skipped).toBe(3);
  });

  it("maps nutrients correctly", () => {
    const csv = SAMPLE_INNDB_CSV;
    importInndb(csv, DEFAULT_INNDB_MAPPING);
    const foods = listCapturedFoods();
    const paneer = foods.find((f: any) => f.name === "Paneer (homemade)")!;
    expect(paneer).toBeDefined();
    expect(paneer.nutrients.ENERC_KCAL.amount).toBe(265);
    expect(paneer.nutrients.PROCNT.amount).toBe(18.3);
  });
});
