import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";

// The estimate module imports the db client at module scope, so the throwaway
// path must be set before any app imports evaluate.
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nutriplan-estimate-food-"));
  process.env.NUTRIPLAN_DB_PATH = join(dir, "test.sqlite");
  process.env.__NUTRIPLAN_TEST_DIR = dir;
});

import { estimateNutrients, type EstimateOptions } from "@/lib/ai/estimate-food";
import type { Food } from "@/lib/nutrition/types";
import { NUTRIENT_CODES, NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";

function makeFood(overrides: Partial<Record<NutrientCode, { amount: number | null; status?: "known" | "estimated" | "unknown" }>> = {}): Food {
  const nutrients = {} as Food["nutrients"];
  for (const code of NUTRIENT_CODES) {
    const o = overrides[code];
    nutrients[code] = o
      ? { amount: o.amount, status: o.status ?? (o.amount == null ? "unknown" : "known"), source: "test" }
      : { amount: null, status: "unknown", source: "test" };
  }
  return {
    id: "f",
    name: "Test Food",
    aliases: ["tasty test"],
    category: "Custom",
    kind: "provisional",
    state: "raw",
    portions: [],
    nutrients,
  } as Food;
}

const completeFn: EstimateOptions["completeFn"] = async (_req) => ({
  text: JSON.stringify({
    values: [
      { nutrient: "PROCNT", amountPer100g: 18.3, reason: "paneer typical", confidence: "high" },
      { nutrient: "ENERC_KCAL", amountPer100g: 265, reason: "paneer typical 265 kcal", confidence: "high" },
      { nutrient: "FE", amountPer100g: 5, reason: "notional", confidence: "medium" },
      { nutrient: "CA", amountPer100g: 100, reason: "unknown confidence", confidence: "bogus" },
    ],
    notes: "Estimated against IFCT-ish references.",
  }),
  latencyMs: 5,
});

describe("estimateNutrients", () => {
  it("fills only missing nutrients, never known ones", async () => {
    const food = makeFood({ ENERC_KCAL: { amount: 301 }, PROCNT: { amount: 20 } });
    const result = await estimateNutrients(food, { completeFn, masterPrompt: "test persona" });
    const codes = result.fills.map((fill) => fill.code);
    expect(codes).not.toContain("ENERC_KCAL");
    expect(codes).not.toContain("PROCNT");
    expect(codes).toContain("FE");
    expect(codes).toContain("CA");
  });

  it("drops physically implausible values instead of trusting the model", async () => {
    const absurd: EstimateOptions["completeFn"] = async () => ({
      text: JSON.stringify({
        values: [
          { nutrient: "ENERC_KCAL", amountPer100g: 5000, reason: "not physically possible", confidence: "high" },
          { nutrient: "PROCNT", amountPer100g: -3, reason: "negative", confidence: "high" },
          { nutrient: "FAT", amountPer100g: 12.5, reason: "reasonable", confidence: "low" },
        ],
        notes: "",
      }),
      latencyMs: 1,
    });
    const result = await estimateNutrients(makeFood(), { completeFn: absurd, masterPrompt: "" });
    const codes = result.fills.map((fill) => fill.code);
    expect(codes).not.toContain("ENERC_KCAL");
    expect(codes).not.toContain("PROCNT");
    expect(codes).toContain("FAT");
  });

  it("confidence falls back to low when the model invents a level", async () => {
    const result = await estimateNutrients(makeFood(), { completeFn, masterPrompt: "" });
    const ca = result.fills.find((fill) => fill.code === "CA")!;
    expect(ca.confidence).toBe("low");
  });

  it("throws a clear error when the model returns non-JSON", async () => {
    const broken: EstimateOptions["completeFn"] = async () => ({ text: "sorry I cannot", latencyMs: 1 });
    await expect(estimateNutrients(makeFood(), { completeFn: broken, masterPrompt: "" })).rejects.toThrow(/usable JSON/);
  });

  it("returns no fills when everything is already known", async () => {
    const allKnown = Object.fromEntries(
      NUTRIENT_CODES.map((code) => [code, { amount: 1, status: "known" as const }]),
    );
    const food = makeFood(allKnown);
    const result = await estimateNutrients(food, { completeFn, masterPrompt: "" });
    expect(result.fills).toHaveLength(0);
  });
});

describe("fillEstimatedCapturedFood", () => {
  const dir = process.env.__NUTRIPLAN_TEST_DIR!;
  let foods: typeof import("@/lib/db/foods");

  beforeAll(async () => {
    foods = await import("@/lib/db/foods");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fills only unknown nutrients, tags them estimated + ai:<model>, keeps known values", async () => {
    const { prepareCapturedFood } = await import("@/lib/captured-food");
    const prepared = prepareCapturedFood({
      name: "AI test paneer",
      aliases: [],
      category: "Dairy",
      kind: "provisional",
      state: "raw",
      source: "manual",
      nutrients: { PROCNT: 18.3 },
    });
    if (!prepared.ok) throw new Error(prepared.message);
    const saved = foods.saveCapturedFood(prepared.food, { allowDuplicate: true });
    if (!saved.ok) throw new Error(saved.message);

    const result = foods.fillEstimatedCapturedFood(saved.food.id, [
      { code: "PROCNT", amount: 99, confidence: "high", reason: "must not overwrite", model: "test:model" },
      { code: "ENERC_KCAL", amount: 265, confidence: "medium", reason: "paneer typical", model: "test:model" },
      { code: "CA", amount: 208, confidence: "low", reason: "label typical", model: "test:model" },
    ]);
    expect(result.filled).toBe(2);

    const reloaded = foods.listFoods().find((food) => food.id === saved.food.id)!;
    expect(reloaded.nutrients.PROCNT.amount).toBe(18.3);
    expect(reloaded.nutrients.PROCNT.status).toBe("known");
    expect(reloaded.nutrients.ENERC_KCAL.amount).toBe(265);
    expect(reloaded.nutrients.ENERC_KCAL.status).toBe("estimated");
    expect(reloaded.nutrients.ENERC_KCAL.method).toBe("ai:test:model");
    expect(reloaded.nutrients.ENERC_KCAL.note).toContain("paneer typical");
    expect(reloaded.nutrients.CA.status).toBe("estimated");
  });
});
