import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FoodsBrowser } from "@/components/foods-browser";
import { SEED_FOODS } from "@/lib/data/foods";
import { parseRecipeFragment } from "@/lib/recipe-fragment";

// userEvent.setup() stubs navigator.clipboard with a real text buffer —
// read it back instead of fighting the stub with our own spy.

describe("foods browser: selection", () => {
  it("starts with nothing selected and the copy button disabled", () => {
    render(<FoodsBrowser foods={SEED_FOODS} />);
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy selected/i })).toBeDisabled();
  });

  it("selects individual foods by their checkboxes", async () => {
    const user = userEvent.setup();
    render(<FoodsBrowser foods={SEED_FOODS} />);

    const name = SEED_FOODS[0].name;
    await user.click(screen.getByRole("checkbox", { name: `Select ${name}` }));

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: `Select ${name}` })).toBeChecked();
  });

  it("select all shown toggles the visible list only", async () => {
    const user = userEvent.setup();
    render(<FoodsBrowser foods={SEED_FOODS} />);

    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
    expect(screen.getByText(`${SEED_FOODS.length} selected`)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /select all/i }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("copies the selection as a recipe fragment with grams of 100", async () => {
    const user = userEvent.setup();
    render(<FoodsBrowser foods={SEED_FOODS} />);

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
    expect(parsed.fragment.nodes.every((n) => n.data.grams === 100)).toBe(true);
    expect(parsed.fragment.edges).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(/Copied 2 foods/i);
  });

  it("clear empties the selection", async () => {
    const user = userEvent.setup();
    render(<FoodsBrowser foods={SEED_FOODS} />);

    await user.click(screen.getByRole("checkbox", { name: `Select ${SEED_FOODS[0].name}` }));
    await user.click(screen.getByRole("button", { name: /^clear$/i }));

    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy selected/i })).toBeDisabled();
  });
});
