import { describe, expect, it } from "vitest";
import { makeProfile } from "@/lib/nutrition/engine";
import { computeRecipe, yieldNote } from "@/lib/nutrition/recipe";
import { getSeedFood as getFood } from "@/lib/data/foods";

const paneer = makeProfile({ ENERC_KCAL: 265, PROCNT: 18.3, FAT: 20.8, CHOCDF: 1.2 }, "test");
const oil = makeProfile({ ENERC_KCAL: 884, PROCNT: 0, FAT: 100, CHOCDF: 0 }, "test");
const onion = makeProfile({ ENERC_KCAL: 40, PROCNT: 1.1, FAT: 0.1, CHOCDF: 9.3, FE: 0.21 }, "test");

describe("recipe blocks", () => {
  const blocks = [
    {
      name: "Prep",
      operation: "dice",
      inputs: [{ label: "onion", profile: onion, grams: 100 }],
    },
    {
      name: "Cook",
      operation: "fry",
      inputs: [
        { label: "paneer", profile: paneer, grams: 100 },
        { label: "oil", profile: oil, grams: 10 },
      ],
    },
  ];

  it("gives each block its own subtotal", () => {
    const result = computeRecipe(blocks, 2);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].result.totals.ENERC_KCAL).toBeCloseTo(40, 5);
    expect(result.blocks[1].result.totals.ENERC_KCAL).toBeCloseTo(265 + 88.4, 5);
  });

  it("sums the blocks into a recipe total", () => {
    const result = computeRecipe(blocks, 2);
    expect(result.total.totals.ENERC_KCAL).toBeCloseTo(40 + 265 + 88.4, 5);
  });

  it("divides by servings without changing the total", () => {
    const result = computeRecipe(blocks, 2);
    expect(result.perServing.totals.ENERC_KCAL).toBeCloseTo(
      (result.total.totals.ENERC_KCAL ?? 0) / 2,
      5,
    );
    expect(result.total.totals.PROCNT).toBeCloseTo(19.4, 5);
    expect(result.perServing.totals.PROCNT).toBeCloseTo(9.7, 5);
  });

  it("treats a single block exactly like a flat ingredient list", () => {
    const flat = [
      { label: "paneer", profile: paneer, grams: 100 },
      { label: "oil", profile: oil, grams: 10 },
    ];
    const oneBlock = computeRecipe([{ name: "All", inputs: flat }], 1);

    expect(oneBlock.total.totals.ENERC_KCAL).toBeCloseTo(265 + 88.4, 5);
    expect(oneBlock.blocks).toHaveLength(1);
  });

  it("combines coverage across blocks instead of losing it", () => {
    const result = computeRecipe(blocks, 1);

    // Iron is known for the onion only: 1 of 3 ingredients.
    expect(result.total.coverage.FE).toEqual({ known: 1, total: 3 });
    expect(result.total.status.FE).toBe("estimated");
    expect(result.total.totals.FE).toBeCloseTo(0.21, 5);
  });

  it("does not let an ingredient without data suppress the others", () => {
    const result = computeRecipe(
      [{ name: "All", inputs: [{ label: "onion", profile: onion, grams: 100 }, { label: "oil", profile: oil, grams: 10 }] }],
      1,
    );
    expect(result.total.totals.ENERC_KCAL).toBeCloseTo(128.4, 5);
    expect(result.total.status.ENERC_KCAL).toBe("known");
  });
});

describe("yield", () => {
  const blocks = [
    {
      name: "Boil",
      operation: "boil",
      inputs: [{ label: "onion", profile: onion, grams: 200 }],
      outputGrams: 180,
    },
  ];

  it("changes per-100 g but not the total when a yield is measured", () => {
    const withYield = computeRecipe(blocks, 1);
    const withoutYield = computeRecipe(
      [{ ...blocks[0], outputGrams: null }],
      1,
    );

    expect(withYield.total.totals.ENERC_KCAL).toBeCloseTo(80, 5);
    expect(withoutYield.total.totals.ENERC_KCAL).toBeCloseTo(80, 5);

    // 80 kcal spread over 180 g, not 200 g.
    expect(withYield.per100g?.totals.ENERC_KCAL).toBeCloseTo((80 / 180) * 100, 5);
    expect(withoutYield.per100g).toBeNull();
  });

  it("reports the yield basis so the assumption can be disclosed", () => {
    expect(computeRecipe(blocks, 1).yieldBasis).toBe("measured");
    expect(computeRecipe([{ ...blocks[0], outputGrams: null }], 1).yieldBasis).toBe("none");

    const partial = computeRecipe(
      [
        blocks[0],
        { name: "Mix", inputs: [{ label: "paneer", profile: paneer, grams: 100 }] },
      ],
      1,
    );
    expect(partial.yieldBasis).toBe("partial");
    expect(partial.per100g).toBeNull();
  });

  it("describes the assumption in plain language", () => {
    expect(yieldNote(computeRecipe(blocks, 1))).toMatch(/measured/);
    expect(yieldNote(computeRecipe([{ ...blocks[0], outputGrams: null }], 1))).toMatch(
      /treated as equal/,
    );
  });

  it("ignores a nonsense output mass rather than dividing by it", () => {
    const result = computeRecipe([{ ...blocks[0], outputGrams: 0 }], 1);
    expect(result.yieldBasis).toBe("none");
    expect(result.per100g).toBeNull();
  });

  it("rejects a non-positive serving count", () => {
    expect(() => computeRecipe(blocks, 0)).toThrow();
  });
});

describe("seed foods through the recipe path", () => {
  it("matches the worked example in the nutrition contract", () => {
    // docs/reference/NUTRITION.md §11, within rounding.
    const result = computeRecipe(
      [
        {
          name: "Grate",
          inputs: [{ label: "paneer", profile: getFood("paneer")!.nutrients, grams: 100 }],
        },
        {
          name: "Sauté",
          inputs: [
            { label: "oil", profile: getFood("mustard-oil")!.nutrients, grams: 5 },
            { label: "onion", profile: getFood("onion")!.nutrients, grams: 50 },
            { label: "tomato", profile: getFood("tomato")!.nutrients, grams: 50 },
          ],
        },
      ],
      2,
    );

    expect(result.total.totals.ENERC_KCAL!).toBeGreaterThan(330);
    expect(result.total.totals.ENERC_KCAL!).toBeLessThan(350);
    expect(result.perServing.totals.PROCNT!).toBeCloseTo(9.7, 0);
  });
});
