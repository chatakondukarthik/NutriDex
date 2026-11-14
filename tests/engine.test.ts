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
import { FOODS, getFood, searchFoods } from "@/lib/data/foods";
import { toGrams } from "@/lib/nutrition/units";

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
    for (const food of FOODS) {
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

  it("flags a missing density instead of assuming silently", () => {
    const result = toGrams(paneer, { amount: 100, unit: "ml" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.note).toMatch(/1 g\/ml/);
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
});

describe("completeness", () => {
  it("is the fraction of tracked nutrients with a value", () => {
    const profile = makeProfile({ PROCNT: 1, FAT: 1 }, "test");
    expect(completeness(profile)).toBeCloseTo(2 / NUTRIENT_CODES.length, 5);
  });
});

describe("search", () => {
  it("finds a food by its Indian name", () => {
    expect(searchFoods("palak")[0]?.id).toBe("spinach");
    expect(searchFoods("doodh")[0]?.id).toBe("milk");
  });

  it("ranks an exact name above a substring", () => {
    expect(searchFoods("rice")[0]?.id).toBe("rice");
  });

  it("returns everything for an empty query", () => {
    expect(searchFoods("").length).toBe(FOODS.length);
  });
});
