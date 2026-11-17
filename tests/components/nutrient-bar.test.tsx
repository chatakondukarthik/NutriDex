import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NutrientBar } from "@/components/nutrient-bar";
import type { NutrientCoverage, Rollup } from "@/lib/nutrition/engine";
import { NUTRIENT_CODES, type NutrientCode, type NutrientStatus } from "@/lib/nutrition/types";
import type { Assessment, Target } from "@/lib/targets";

/**
 * The bar must take its cut-offs from the target, not from constants.
 *
 * A user who moves "red at" to 40% expects 30% over to stay amber. The
 * assessment path is the plan board; the raw path is the diary.
 */

function rollup(values: Partial<Record<NutrientCode, number | null>>): Rollup {
  const totals = {} as Record<NutrientCode, number | null>;
  const status = {} as Record<NutrientCode, NutrientStatus>;
  const coverage = {} as Record<NutrientCode, NutrientCoverage>;

  for (const code of NUTRIENT_CODES) {
    const value = code in values ? values[code]! : 0;
    totals[code] = value;
    status[code] = value == null ? "unknown" : "known";
    coverage[code] = value == null ? { known: 0, total: 1 } : { known: 1, total: 1 };
  }

  return { totals, status, coverage };
}

function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    code: "ENERC_KCAL",
    role: "daily-anchor",
    status: "met",
    actual: 115,
    target: 100,
    ratio: 1.15,
    coverage: { known: 1, total: 1 },
    amberOver: 0,
    redAt: 0.2,
    ...overrides,
  };
}

function fill(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".bar-fill");
  if (!element) throw new Error("The bar was not drawn.");
  return element;
}

describe("assessment path", () => {
  it("turns amber past the amber cut-off and before red", () => {
    const { container, getByText } = render(
      <NutrientBar code="ENERC_KCAL" assessment={assessment()} />,
    );
    expect(fill(container).className).toContain("bg-warn");
    expect(getByText("over target")).toBeInTheDocument();
  });

  it("turns red at the red cut-off", () => {
    const { container, getByText } = render(
      <NutrientBar code="ENERC_KCAL" assessment={assessment({ actual: 120, ratio: 1.2 })} />,
    );
    expect(fill(container).className).toContain("bg-danger");
    expect(getByText("well over target")).toBeInTheDocument();
  });

  it("respects a raised amber cut-off", () => {
    const { container } = render(
      <NutrientBar code="ENERC_KCAL" assessment={assessment({ amberOver: 0.25 })} />,
    );
    // 15% over is below a 25% amber cut-off, so it keeps the met colour.
    expect(fill(container).className).toContain("bg-accent");
    expect(fill(container).className).not.toContain("bg-warn");
  });

  it("respects a raised red cut-off", () => {
    const { container } = render(
      <NutrientBar
        code="ENERC_KCAL"
        assessment={assessment({ actual: 130, ratio: 1.3, redAt: 0.4 })}
      />,
    );
    expect(fill(container).className).toContain("bg-warn");
    expect(fill(container).className).not.toContain("bg-danger");
  });
});

describe("raw rollup path", () => {
  function target(overrides: Partial<Target> = {}): Target {
    return {
      code: "PROCNT",
      value: 100,
      direction: "min",
      period: "day",
      role: "daily-anchor",
      tolerance: 0.1,
      amberOver: 0.3,
      redAt: 0.5,
      ...overrides,
    };
  }

  it("uses the target's cut-offs instead of 1.2/1", () => {
    const { container } = render(
      <NutrientBar code="PROCNT" result={rollup({ PROCNT: 115 })} target={target()} />,
    );
    expect(fill(container).className).toContain("bg-accent");
  });

  it("escalates between the target's cut-offs", () => {
    const { container, getByText } = render(
      <NutrientBar code="PROCNT" result={rollup({ PROCNT: 140 })} target={target()} />,
    );
    expect(fill(container).className).toContain("bg-warn");
    expect(getByText("over target")).toBeInTheDocument();
  });

  it("escalates at the target's red cut-off", () => {
    const { container, getByText } = render(
      <NutrientBar code="PROCNT" result={rollup({ PROCNT: 160 })} target={target()} />,
    );
    expect(fill(container).className).toContain("bg-danger");
    expect(getByText("well over target")).toBeInTheDocument();
  });

  it("draws an empty bar and no note when there is no target", () => {
    const { container } = render(
      <NutrientBar code="PROCNT" result={rollup({ PROCNT: 115 })} />,
    );
    const bar = fill(container);
    expect(bar.style.width).toBe("0%");
    expect(bar.className).toContain("bg-ink/25");
  });
});
