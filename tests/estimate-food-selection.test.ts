import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nutriplan-estimate-select-"));
  process.env.NUTRIPLAN_DB_PATH = join(dir, "test.sqlite");
  process.env.__NUTRIPLAN_TEST_DIR = dir;
});

import {
  estimateNutrients,
  fillAllWithAi,
  sanitizeNutrientCodes,
  type EstimateOptions,
} from "@/lib/ai/estimate-food";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";
import type { Food } from "@/lib/nutrition/types";

function makeFood(
  overrides: Partial<Record<NutrientCode, { amount: number | null; status?: "known" | "estimated" | "unknown" }>> = {},
): Food {
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
    aliases: [],
    category: "Custom",
    kind: "provisional",
    state: "raw",
    portions: [],
    nutrients,
  } as Food;
}

const modelReplies = {
  values: [
    { nutrient: "PROCNT", amountPer100g: 18.3, reason: "paneer typical", confidence: "high" },
    { nutrient: "NA", amountPer100g: 60, reason: "paneer typical", confidence: "medium" },
    { nutrient: "VITC", amountPer100g: 0, reason: "zero invented", confidence: "low" },
  ],
  notes: "test",
};

describe("sanitizeNutrientCodes", () => {
  it("drops anything that is not a tracked code, dedupes, keeps order of first sight", () => {
    expect(sanitizeNutrientCodes(["PROCNT", "junk", "PROCNT", "NA", 42, null])).toEqual(["PROCNT", "NA"]);
  });

  it("returns an empty list for non-arrays and unknown-only input", () => {
    expect(sanitizeNutrientCodes("PROCNT")).toEqual([]);
    expect(sanitizeNutrientCodes(["NOT_A_CODE"])).toEqual([]);
    expect(sanitizeNutrientCodes(undefined)).toEqual([]);
    expect(sanitizeNutrientCodes(null)).toEqual([]);
  });
});

describe("estimateNutrients with a selection", () => {
  it("asks the model only about the selected nutrients and ignores out-of-scope fills", async () => {
    let prompt = "";
    const completeFn: EstimateOptions["completeFn"] = async (req) => {
      prompt = req.prompt;
      return { text: JSON.stringify(modelReplies), latencyMs: 1 };
    };
    const food = makeFood({ ENERC_KCAL: { amount: 300 } });
    const result = await estimateNutrients(food, {
      completeFn,
      masterPrompt: "",
      codes: new Set(["PROCNT", "NA"]),
    });

    expect(prompt).toContain("PROCNT");
    expect(prompt).toContain("NA");
    expect(prompt).not.toContain("VITC [");
    expect(prompt).not.toContain("VITD");
    expect(result.fills.map((fill) => fill.code)).toEqual(expect.arrayContaining(["PROCNT", "NA"]));
    expect(result.fills.map((fill) => fill.code)).not.toContain("VITC");
    expect(result.fills.map((fill) => fill.code)).not.toContain("ENERC_KCAL");
  });

  it("an empty selection fills nothing and never calls the model", async () => {
    let called = false;
    const completeFn: EstimateOptions["completeFn"] = async () => {
      called = true;
      return { text: JSON.stringify(modelReplies), latencyMs: 1 };
    };
    const result = await estimateNutrients(makeFood(), {
      completeFn,
      masterPrompt: "",
      codes: new Set(),
    });
    expect(result.fills).toHaveLength(0);
    expect(called).toBe(false);
  });
});

describe("fillAllWithAi with a selection", () => {
  const dir = process.env.__NUTRIPLAN_TEST_DIR!;
  let saved: typeof import("@/lib/db/foods");

  beforeAll(async () => {
    saved = await import("@/lib/db/foods");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function capture(name: string, nutrients: Record<string, number>) {
    const { prepareCapturedFood } = await import("@/lib/captured-food");
    const prepared = prepareCapturedFood({
      name,
      aliases: [],
      category: "Custom",
      kind: "provisional",
      state: "raw",
      source: "manual",
      nutrients,
    });
    if (!prepared.ok) throw new Error(prepared.message);
    const result = saved.saveCapturedFood(prepared.food, { allowDuplicate: true });
    if (!result.ok) throw new Error(result.message);
    return result.food.id;
  }

  it("fills only the selected unknowns of the given foods", async () => {
    const id = await capture("Selection Test Food", { PROCNT: 10 });
    const completeFn: EstimateOptions["completeFn"] = async () => ({
      text: JSON.stringify(modelReplies),
      latencyMs: 1,
    });
    const result = await fillAllWithAi({
      completeFn,
      masterPrompt: "",
      foodIds: [id],
      nutrientCodes: ["NA"], // PROCNT is known, NA is the only selected unknown
    });
    expect(result.foodsEstimated).toBe(1);
    const reloaded = saved.listFoods().find((food) => food.id === id)!;
    expect(reloaded.nutrients.PROCNT.amount).toBe(10); // untouched
    expect(reloaded.nutrients.NA.amount).toBe(60);
    expect(reloaded.nutrients.NA.status).toBe("estimated");
    expect(reloaded.nutrients.VITC.amount).toBeNull(); // never selected, never filled
  });

  it("an empty selection makes zero model calls and fills nothing", async () => {
    const id = await capture("Empty Selection Food", {});
    let calls = 0;
    const completeFn: EstimateOptions["completeFn"] = async () => {
      calls += 1;
      return { text: JSON.stringify(modelReplies), latencyMs: 1 };
    };
    const result = await fillAllWithAi({
      completeFn,
      masterPrompt: "",
      foodIds: [id],
      nutrientCodes: [],
    });
    expect(calls).toBe(0);
    expect(result.nutritionEntries).toBe(0);
    const reloaded = saved.listFoods().find((food) => food.id === id)!;
    expect(reloaded.nutrients.NA.amount).toBeNull();
  });
});
