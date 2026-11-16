import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FoodsBrowser } from "@/components/foods-browser";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
import { SEED_FOODS } from "@/lib/data/foods";
import { parseRecipeFragment } from "@/lib/recipe-fragment";
import { defaultAmountFor } from "@/lib/nutrition/defaults";
import { toGrams, parseUnitKey } from "@/lib/nutrition/units";

// userEvent.setup() stubs navigator.clipboard with a real text buffer —
// read it back instead of fighting the stub with our own spy.

describe("foods browser: selection", () => {
  it("starts with nothing selected and the copy button disabled", () => {
    render(<FoodsBrowser foods={SEED_FOODS} aiEnabled={false} hasKey={true} />);
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy selected/i })).toBeDisabled();
  });

  it("selects individual foods by their checkboxes", async () => {
    const user = userEvent.setup();
    render(<FoodsBrowser foods={SEED_FOODS} aiEnabled={false} hasKey={true} />);

    const name = SEED_FOODS[0].name;
    await user.click(screen.getByRole("checkbox", { name: `Select ${name}` }));

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: `Select ${name}` })).toBeChecked();
  });

  it("select all shown toggles the visible list only", async () => {
    const user = userEvent.setup();
    render(<FoodsBrowser foods={SEED_FOODS} aiEnabled={false} hasKey={true} />);

    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
    expect(screen.getByText(`${SEED_FOODS.length} selected`)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("copies the selection with each food's own default quantity", async () => {
    const user = userEvent.setup();
    render(<FoodsBrowser foods={SEED_FOODS} aiEnabled={false} hasKey={true} />);

    const [first, second] = SEED_FOODS;
    await user.click(screen.getByRole("checkbox", { name: `Select ${first.name}` }));
    await user.click(screen.getByRole("checkbox", { name: `Select ${second.name}` }));
    await user.click(screen.getByRole("button", { name: /copy selected/i }));
    const json = await window.navigator.clipboard.readText();

    const parsed = parseRecipeFragment(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.fragment.nodes).toHaveLength(2);
    expect(parsed.fragment.nodes.map((n) => n.data.foodId)).toEqual([first.id, second.id]);
    // Each node carries the food's own default (portion → rules → 100 g),
    // converted to grams — not a hardcoded 100.
    const expected = [first, second].map((food) => {
      const chosen = defaultAmountFor(food);
      const parsedUnit = parseUnitKey(chosen.unit);
      const converted = toGrams(food, {
        amount: chosen.amount,
        unit: parsedUnit.unit,
        portionLabel: parsedUnit.portionLabel,
      });
      return converted.ok ? converted.grams : chosen.amount;
    });
    expect(parsed.fragment.nodes.map((n) => n.data.grams)).toEqual(expected);
    expect(parsed.fragment.nodes.every((n) => typeof n.data.amount === "number")).toBe(true);
    expect(parsed.fragment.edges).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(/Copied 2 foods/i);
  });

  it("clear empties the selection", async () => {
    const user = userEvent.setup();
    render(<FoodsBrowser foods={SEED_FOODS} aiEnabled={false} hasKey={true} />);

    await user.click(screen.getByRole("checkbox", { name: `Select ${SEED_FOODS[0].name}` }));
    await user.click(screen.getByRole("button", { name: /^clear$/i }));

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy selected/i })).toBeDisabled();
  });
});
