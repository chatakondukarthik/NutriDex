import { describe, expect, it } from "vitest";
import {
  atwaterKcal,
  completeness,
  emptyProfile,
  energyDriftPercent,
  makeProfile,
  perServing,
  rollup,
  scaleProfile,
} from "@/lib/nutrition/engine";
import { NUTRIENT_CODES } from "@/lib/nutrition/types";
import { SEED_FOODS, getSeedFood as getFood } from "@/lib/data/foods";
import { searchFoods } from "@/lib/nutrition/food-search";
import { toGrams, MAX_GRAMS } from "@/lib/nutrition/units";

describe("profiles", () => {
  it("treats omitted nutrients as unknown, never as zero", () => {
    const profile = makeProfile({ PROCNT: 10 }, "test");

    expect(profile.PROCNT.amount).toBe(10);
    expect(profile.PROCNT.status).toBe("known");
    expect(profile.FE.amount).toBeNull();
    expect(profile.FE.status).toBe("unknown");
    expect(profile.FE.amount).not.toBe(0);
  });

  it("starts every nutrient in an empty profile as unknown", () => {
    const profile = emptyProfile();
    for (const code of NUTRIENT_CODES) {
      expect(profile[code].amount).toBeNull();
    }
  });

  it("keeps provenance on every known value", () => {
    const profile = makeProfile({ CA: 480 }, "IFCT 2017", "P001");
    expect(profile.CA.source).toBe("IFCT 2017");
    expect(profile.CA.sourceFoodCode).toBe("P001");
  });

  it("scales a per-100 g profile to a gram weight", () => {
    const profile = makeProfile({ PROCNT: 20 }, "test");
    const scaled = scaleProfile(profile, 50);

    expect(scaled.PROCNT.amount).toBe(10);
    expect(scaled.FE.amount).toBeNull();
  });

  it("does not scale unknown values into zero", () => {
    const profile = makeProfile({ PROCNT: 20 }, "test");
    const scaled = scaleProfile(profile, 0);
    expect(scaled.PROCNT.amount).toBe(0);
    expect(scaled.FE.amount).toBeNull();
  });
});

describe("rollup", () => {
  const a = makeProfile({ ENERC_KCAL: 100, PROCNT: 10, FE: 2 }, "a");
  const b = makeProfile({ ENERC_KCAL: 50, PROCNT: 5 }, "b");

  it("sums known values by mass", () => {
    const result = rollup([
      { label: "a", profile: a, grams: 100 },
      { label: "b", profile: b, grams: 200 },
    ]);

    expect(result.totals.ENERC_KCAL).toBeCloseTo(200, 5);
    expect(result.totals.PROCNT).toBeCloseTo(20, 5);
  });

  it("reports partial coverage instead of pretending to know", () => {
    const result = rollup([
      { label: "a", profile: a, grams: 100 },
      { label: "b", profile: b, grams: 100 },
    ]);

    // Iron is known for a only: the total is a lower bound.
    expect(result.coverage.FE).toEqual({ known: 1, total: 2 });
    expect(result.status.FE).toBe("estimated");
    expect(result.totals.FE).toBeCloseTo(2, 5);
  });

  it("marks a nutrient known only when every contribution knows it", () => {
    const result = rollup([
      { label: "a", profile: a, grams: 100 },
      { label: "b", profile: b, grams: 100 },
    ]);

    expect(result.status.PROCNT).toBe("known");
    expect(result.coverage.PROCNT).toEqual({ known: 2, total: 2 });
  });

  it("returns unknown, not zero, when nothing knows a nutrient", () => {
    const result = rollup([{ label: "b", profile: b, grams: 100 }]);
    expect(result.totals.FE).toBeNull();
    expect(result.status.FE).toBe("unknown");
    expect(result.coverage.FE).toEqual({ known: 0, total: 1 });
  });

  it("does not let an unknown ingredient suppress a known one", () => {
    const result = rollup([
      { label: "a", profile: a, grams: 100 },
      { label: "empty", profile: emptyProfile(), grams: 500 },
    ]);
    expect(result.totals.PROCNT).toBeCloseTo(10, 5);
    expect(result.status.PROCNT).toBe("estimated");
  });
});

describe("servings", () => {
  it("divides totals but preserves coverage", () => {
    const result = rollup([{ label: "a", profile: makeProfile({ PROCNT: 20 }, "a"), grams: 100 }]);
    const divided = perServing(result, 4);

    expect(divided.totals.PROCNT).toBeCloseTo(5, 5);
    expect(divided.status.PROCNT).toBe("known");
  });

  it("rejects a non-positive serving count", () => {
    const result = rollup([]);
    expect(() => perServing(result, 0)).toThrow();
  });
});

describe("Atwater sanity check", () => {
  it("computes energy from macros", () => {
    const profile = makeProfile({ PROCNT: 10, FAT: 10, CHOCDF: 10 }, "test");
    // 40 + 90 + 40
    expect(atwaterKcal(profile)).toBe(170);
  });

  it("counts fibre at 2 kcal/g and removes it from carbohydrate", () => {
    const profile = makeProfile({ PROCNT: 0, FAT: 0, CHOCDF: 20, FIBTG: 10 }, "test");
    // 10 available carb × 4 + 10 fibre × 2
    expect(atwaterKcal(profile)).toBe(60);
  });

  it("stays within a gross-error tolerance for every seed food with macros", () => {
    // This is a coarse guard, not an accuracy assertion. Reference tables
    // use food-group-specific Atwater factors and different fibre
    // conventions, so a single generic formula cannot reproduce every
    // stated value. What it does catch is a record resolved to the wrong
    // food, which shows up as a 2x drift.
    for (const food of SEED_FOODS) {
      const stated = food.nutrients.ENERC_KCAL.amount;
      if (stated == null || stated < 50) continue;

      const drift = energyDriftPercent(food.nutrients);
      expect(drift, `${food.name} has no drift value`).not.toBeNull();
      expect(Math.abs(drift!), `${food.name} drifts ${drift!.toFixed(1)}%`).toBeLessThan(20);
    }
  });
});

describe("units", () => {
  const paneer = getFood("paneer")!;
  const oil = getFood("mustard-oil")!;

  it("converts grams directly", () => {
    const result = toGrams(paneer, { amount: 100, unit: "g" });
    expect(result).toMatchObject({ ok: true, grams: 100, basis: "mass" });
  });

  it("converts kilograms", () => {
    const result = toGrams(paneer, { amount: 1, unit: "kg" });
    expect(result.ok && result.grams).toBe(1000);
  });

  it("uses density for millilitres", () => {
    const result = toGrams(oil, { amount: 15, unit: "ml" });
    expect(result.ok && result.grams).toBeCloseTo(13.8, 5);
  });

  it("flags a missing density with a visible, specific assumption", () => {
    const result = toGrams(paneer, { amount: 100, unit: "ml" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.note).toMatch(/assumed/i);
      expect(result.note).toMatch(/paneer/i);
    }
  });

  it("converts a named household portion", () => {
    const result = toGrams(paneer, { amount: 2, unit: "portion", portionLabel: "1 katori" });
    expect(result.ok && result.grams).toBe(200);
  });

  it("fails loudly on an unknown portion", () => {
    const result = toGrams(paneer, { amount: 1, unit: "portion", portionLabel: "1 bucket" });
    expect(result.ok).toBe(false);
  });

  it("rejects non-positive quantities", () => {
    expect(toGrams(paneer, { amount: 0, unit: "g" }).ok).toBe(false);
    expect(toGrams(paneer, { amount: -5, unit: "g" }).ok).toBe(false);
  });

  it("rejects a quantity whose gram weight overflows", () => {
    // 1e308 is a finite number; multiplying by 1000 is not.
    const result = toGrams(paneer, { amount: 1e308, unit: "kg" });
    expect(result.ok).toBe(false);
  });

  it("rejects an absurd but finite quantity instead of storing it", () => {
    expect(toGrams(paneer, { amount: 1e9, unit: "g" }).ok).toBe(false);
    expect(toGrams(paneer, { amount: MAX_GRAMS, unit: "g" }).ok).toBe(true);
  });
});

describe("completeness", () => {
  it("is the fraction of tracked nutrients with a value", () => {
    const profile = makeProfile({ PROCNT: 1, FAT: 1 }, "test");
    expect(completeness(profile)).toBeCloseTo(2 / NUTRIENT_CODES.length, 5);
  });
});

describe("search", () => {
  it("finds a food by its Indian name", () => {
    expect(searchFoods(SEED_FOODS, "palak")[0]?.id).toBe("spinach");
    expect(searchFoods(SEED_FOODS, "doodh")[0]?.id).toBe("milk");
  });

  it("ranks an exact name above a substring", () => {
    expect(searchFoods(SEED_FOODS, "rice")[0]?.id).toBe("rice");
  });

  it("returns everything for an empty query", () => {
    expect(searchFoods(SEED_FOODS, "").length).toBe(SEED_FOODS.length);
  });
});

describe("units: extended", () => {
  const paneer = getFood("paneer")!;
  const oil = getFood("mustard-oil")!;
  const milk = getFood("whole-milk") ?? getFood("milk");

  it("converts ounces", () => {
    const result = toGrams(paneer, { amount: 1, unit: "oz" });
    expect(result.ok && Math.round(result.grams * 1000)).toBe(28350);
  });

  it("converts pounds", () => {
    const result = toGrams(paneer, { amount: 1, unit: "lb" });
    expect(result.ok && Math.round(result.grams)).toBe(454);
  });

  it("converts teaspoons and cups of oil via density", () => {
    const tsp = toGrams(oil, { amount: 1, unit: "tsp" });
    expect(tsp.ok && tsp.grams).toBeCloseTo(4.929 * 0.92, 3);
    const cup = toGrams(oil, { amount: 1, unit: "cup" });
    expect(cup.ok && cup.grams).toBeCloseTo(236.5882365 * 0.92, 2);
  });

  it("converts fluid ounces", () => {
    const result = toGrams(oil, { amount: 1, unit: "fl_oz" });
    expect(result.ok && result.grams).toBeCloseTo(29.5735 * 0.92, 2);
  });

  it("converts cups of a densityless food with an explicit assumption note", () => {
    const result = toGrams(paneer, { amount: 1, unit: "cup" });
    expect(result.ok && result.basis).toBe("volume");
    if (result.ok) expect(result.note).toMatch(/assumed/i);
  });

  it("converts an egg as a household portion (\u003c 3 × 1 large = 150 g)", () => {
    const egg = getFood("egg");
    expect(egg).toBeDefined();
    const result = toGrams(egg!, { amount: 3, unit: "portion", portionLabel: "1 large" });
    expect(result.ok && result.grams).toBe(150);
  });

  it("uses density for millilitres", () => {
    if (milk) {
      const result = toGrams(milk, { amount: 250, unit: "ml" });
      expect(result.ok && result.grams).toBeCloseTo(257.5, 1);
    }
  });
});

describe("unitsFor offers everything the diary needs", () => {
  it("includes masses, volumes and portions", async () => {
    const { unitsFor } = await import("@/lib/nutrition/units");
    const egg = getFood("egg")!;
    const options = unitsFor(egg).map((option) => option.value);
    expect(options).toEqual(expect.arrayContaining(["g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "fl_oz", "cup"]));
    expect(options).toContain("portion:1 large");
  });
});

describe("density guesses replace the 1 g/ml placeholder", () => {
  const oil = getFood("mustard-oil")!;
  const paneer = getFood("paneer")!;

  it("uses real density for oils, not 1 g/ml", () => {
    const result = toGrams(oil, { amount: 1, unit: "cup" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grams).toBeCloseTo(236.5882365 * 0.92, 2);
      expect(result.note).toBeUndefined(); // real density, no assumption note
    }
  });

  it("assumes flour-like density for gram flour, with a visible note", () => {
    // besan's density is not in the seed — the category name is Custom/Flour?
    // In seed data: besan doesn't exist; use a captured fixture with flour in the name.
    const floury = {
      ...paneer,
      id: "test-flour",
      name: "Whole wheat flour",
      densityGPerMl: undefined,
    };
    const result = toGrams(floury, { amount: 1, unit: "cup" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grams).toBeCloseTo(236.5882365 * 0.57, 2);
      expect(result.note).toMatch(/assumed/i);
      expect(result.note).toMatch(/flour/i);
    }
  });

  it("falls back loudly for a custom-category food with no rule", () => {
    const mystery = {
      ...paneer,
      id: "mystery",
      name: "My new food",
      category: "Custom",
      densityGPerMl: undefined,
    };
    const result = toGrams(mystery, { amount: 250, unit: "ml" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note).toMatch(/1 g\/ml/i);
  });

  it("real density always wins over the guess", () => {
    const withDensity = { ...oil, densityGPerMl: 0.88 };
    const result = toGrams(withDensity, { amount: 1, unit: "cup" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.grams).toBeCloseTo(236.5882365 * 0.88, 2);
  });
});
