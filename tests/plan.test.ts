import { describe, expect, it } from "vitest";
import { FOODS } from "@/lib/data/foods";
import { makeProfile, perServing, rollup } from "@/lib/nutrition/engine";
import type { Food } from "@/lib/nutrition/types";
import {
  SLOTS,
  addDays,
  dayOfMonth,
  dayRollup,
  entriesForDay,
  entryRollup,
  weekDays,
  weekStart,
  type PlanEntry,
  type PlanRecipeOption,
} from "@/lib/plan";

/**
 * The plan's pure layer: calendar arithmetic and what a day totals.
 *
 * The important property is the one the UI promises: an empty day is
 * unknown, not zero, and a planned recipe is read from its stored snapshot
 * rather than recomputed from today's food data.
 */

const paneer = FOODS.find((food) => food.id === "paneer")!;
const foodById = new Map<string, Food>(FOODS.map((food) => [food.id, food]));

const recipeProfile = makeProfile({ ENERC_KCAL: 300, PROCNT: 20 }, "test");
const recipe: PlanRecipeOption = {
  recipeId: "r1",
  name: "Test dish",
  versionId: "v1",
  versionNo: 1,
  servings: 2,
  perServing: perServing(rollup([{ label: "x", profile: recipeProfile, grams: 100 }]), 2),
};
const recipeByVersion = new Map([[recipe.versionId, recipe]]);

function foodEntry(overrides: Partial<PlanEntry> = {}): PlanEntry {
  return {
    id: "e1",
    planId: "p1",
    day: "2026-11-09",
    slot: "breakfast",
    position: 0,
    foodId: paneer.id,
    recipeVersionId: null,
    grams: 100,
    amount: null,
    unit: null,
    servings: null,
    ...overrides,
  };
}

function recipeEntry(overrides: Partial<PlanEntry> = {}): PlanEntry {
  return {
    id: "e2",
    planId: "p1",
    day: "2026-11-09",
    slot: "lunch",
    position: 0,
    foodId: null,
    recipeVersionId: recipe.versionId,
    grams: null,
    amount: null,
    unit: null,
    servings: 1,
    ...overrides,
  };
}

describe("calendar", () => {
  it("treats Monday as the start of the week", () => {
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-14")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-09", 6)).toBe("2026-11-15");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("returns seven consecutive days", () => {
    const days = weekDays("2026-11-09");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-11-09");
    expect(days[6]).toBe("2026-11-15");
    expect(days.map(dayOfMonth)).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });
});

describe("entries", () => {
  it("orders a day by slot, then position", () => {
    const entries = [
      foodEntry({ id: "dinner", slot: "dinner", position: 0 }),
      foodEntry({ id: "lunch-2", slot: "lunch", position: 1 }),
      foodEntry({ id: "lunch-1", slot: "lunch", position: 0 }),
      foodEntry({ id: "other-day", day: "2026-11-10" }),
    ];

    expect(entriesForDay(entries, "2026-11-09").map((entry) => entry.id)).toEqual([
      "lunch-1",
      "lunch-2",
      "dinner",
    ]);
  });

  it("knows every slot", () => {
    expect(SLOTS).toEqual(["breakfast", "lunch", "dinner", "snack"]);
  });
});

describe("rollups", () => {
  it("scales a planned food by its gram weight", () => {
    const result = entryRollup(foodEntry({ grams: 200 }), foodById, recipeByVersion)!;
    const per100 = paneer.nutrients.ENERC_KCAL.amount!;
    expect(result.totals.ENERC_KCAL).toBeCloseTo((per100 * 200) / 100, 5);
  });

  it("scales a planned recipe from its stored snapshot", () => {
    const result = entryRollup(recipeEntry({ servings: 3 }), foodById, recipeByVersion)!;
    expect(result.totals.ENERC_KCAL).toBeCloseTo(450, 5);
    expect(result.totals.PROCNT).toBeCloseTo(30, 5);
  });

  it("does not consult today's food data for a planned recipe", () => {
    // The recipe's own numbers live in the snapshot; a missing food record
    // cannot make a planned recipe disappear.
    const result = entryRollup(recipeEntry(), new Map(), recipeByVersion);
    expect(result?.totals.ENERC_KCAL).toBeCloseTo(150, 5);
  });

  it("returns null for an entry whose target is gone", () => {
    expect(entryRollup(foodEntry({ foodId: "missing" }), foodById, recipeByVersion)).toBeNull();
    expect(
      entryRollup(recipeEntry({ recipeVersionId: "missing" }), foodById, recipeByVersion),
    ).toBeNull();
  });

  it("reports an empty day as unknown, never zero", () => {
    const result = dayRollup([], foodById, recipeByVersion);
    expect(result.totals.ENERC_KCAL).toBeNull();
    expect(result.status.ENERC_KCAL).toBe("unknown");
    expect(result.coverage.ENERC_KCAL).toEqual({ known: 0, total: 0 });
  });

  it("sums a food and a recipe into one day", () => {
    const food = entryRollup(foodEntry({ grams: 100 }), foodById, recipeByVersion)!;
    const dish = entryRollup(recipeEntry(), foodById, recipeByVersion)!;

    const day = dayRollup(
      [foodEntry({ grams: 100 }), recipeEntry()],
      foodById,
      recipeByVersion,
    );

    expect(day.totals.ENERC_KCAL).toBeCloseTo(
      (food.totals.ENERC_KCAL ?? 0) + (dish.totals.ENERC_KCAL ?? 0),
      5,
    );
  });
});
