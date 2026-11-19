import { describe, expect, it } from "vitest";
import { fromGrams, toGrams } from "@/lib/nutrition/units";
import type { Food } from "@/lib/nutrition/types";

const base = {
  id: "egg",
  name: "Egg, whole",
  aliases: [],
  category: "Meat",
  kind: "raw" as const,
  state: "raw" as const,
  portions: [{ label: "1 large", grams: 50, source: "USDA portion" }],
  nutrients: {},
} as unknown as Food;

describe("fromGrams", () => {
  it("converts grams to portions — 500 g of large eggs is 10", () => {
    const result = fromGrams(base, 500, "portion", "1 large");
    expect(result).toEqual({ ok: true, amount: 10 });
  });

  it("round-trips with toGrams for mass", () => {
    expect(fromGrams(base, 454, "lb")).toEqual({ ok: true, amount: 1 });
    const lb = toGrams(base, { amount: 1, unit: "lb" });
    expect(lb.ok && lb.grams).toBeCloseTo(453.59, 1);
  });

  it("round-trips with toGrams for grams and kg", () => {
    expect(fromGrams(base, 1500, "kg")).toEqual({ ok: true, amount: 1.5 });
    expect(fromGrams(base, 500, "g")).toEqual({ ok: true, amount: 500 });
  });

  it("rounds partials to 2 decimals and never returns zero", () => {
    expect(fromGrams(base, 30, "portion", "1 large")).toEqual({ ok: true, amount: 0.6 });
    expect(fromGrams(base, 3, "portion", "1 large")).toEqual({ ok: true, amount: 0.06 });
    expect(fromGrams(base, 1, "portion", "1 large")).toEqual({ ok: true, amount: 0.02 });
  });

  it("volume units use the food's density — unknown density falls back to the guess", () => {
    const water = { ...base, name: "Water (unit test)", portions: [{ label: "1 cup", grams: 236, source: "x" }], densityGPerMl: 1 };
    expect(fromGrams(water, 240, "ml")).toEqual({ ok: true, amount: 240 });
    expect(fromGrams(water, 120, "ml")).toEqual({ ok: true, amount: 120 });
    expect(fromGrams(water, 237, "cup")).toEqual({ ok: true, amount: 1 });
    // No density recorded: the guesser answers rather than throwing.
    const guess = fromGrams(base, 240, "cup");
    expect(guess.ok).toBe(true);
  });

  it("fails honest on unknown portions", () => {
    const result = fromGrams(base, 500, "portion", "1 jumbo");
    expect(result.ok).toBe(false);
  });
});
