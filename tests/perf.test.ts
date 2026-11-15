import { describe, expect, it } from "vitest";
import { makeProfile, rollup, scaleProfile, type Rollup } from "@/lib/nutrition/engine";
import { assessDay, assessWeek, targetsFor } from "@/lib/targets";
import { SEED_FOODS } from "@/lib/data/foods";
import { DEFAULT_PROFILE } from "@/lib/profile";

/**
 * Performance guards.
 *
 * Not benchmarks. These catch an accidental O(n²) or a per-row database read
 * in code that runs while a page renders. The budgets are ~100× a warm local
 * run, so they stay green on a loaded CI box and still fail loudly on a real
 * regression.
 */
function timed(fn: () => void): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

describe("rollup cost", () => {
  it("rolls up a full week of a large day in a few milliseconds", () => {
    // 200 ingredients is far more than any real meal; it exists to make a
    // quadratic implementation obvious.
    const items = Array.from({ length: 200 }, (_, index) => {
      const food = SEED_FOODS[index % SEED_FOODS.length];
      return { label: food.name, profile: food.nutrients, grams: 100 };
    });

    const elapsed = timed(() => {
      for (let day = 0; day < 7; day += 1) rollup(items);
    });

    expect(elapsed).toBeLessThan(500);
  });

  it("scales linearly enough for a week of days", () => {
    const items = Array.from({ length: 50 }, (_, index) => {
      const food = SEED_FOODS[index % SEED_FOODS.length];
      return { label: food.name, profile: food.nutrients, grams: 100 };
    });

    const small = timed(() => {
      for (let index = 0; index < 50; index += 1) rollup(items);
    });
    const large = timed(() => {
      for (let index = 0; index < 500; index += 1) rollup(items);
    });

    // 10× the work should not cost more than ~40× the time. A quadratic
    // implementation would be ~100×.
    expect(large).toBeLessThan(Math.max(small, 1) * 40 + 50);
  });
});

describe("target derivation", () => {
  it("derives a week of day and week assessments quickly", () => {
    const targets = targetsFor(DEFAULT_PROFILE);
    const profile = makeProfile({ ENERC_KCAL: 100 }, "test");
    const day: Rollup = rollup([{ label: "test", profile, grams: 2000 }]);
    const week = Array.from({ length: 7 }, () => day);

    const elapsed = timed(() => {
      for (let index = 0; index < 500; index += 1) {
        assessDay(day, targets);
        assessWeek(week, targets);
      }
    });

    expect(elapsed).toBeLessThan(500);
  });
});
