import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Diary, type DiaryProps } from "@/components/diary";
import { SEED_FOODS } from "@/lib/data/foods";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";
import type { Rollup } from "@/lib/nutrition/engine";
import type { PlanRecipeOption } from "@/lib/plan";
import type { Entry } from "@/lib/db/entries";

const push = vi.fn();
const addFoodAction = vi.fn();
const addRecipeEntryAction = vi.fn();
const removeEntryAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/actions", () => ({
  addFoodAction: (input: unknown) => addFoodAction(input),
  addRecipeEntryAction: (input: unknown) => addRecipeEntryAction(input),
  removeEntryAction: (id: unknown) => removeEntryAction(id),
}));

function perServingRollup(kcal: number): Rollup {
  const totals = Object.fromEntries(
    NUTRIENT_CODES.map((code) => [code, code === "ENERC_KCAL" ? kcal : null]),
  ) as Record<NutrientCode, number | null>;
  const status = Object.fromEntries(
    NUTRIENT_CODES.map((code) => [code, code === "ENERC_KCAL" ? "known" : "unknown"]),
  ) as Rollup["status"];
  const coverage = Object.fromEntries(
    NUTRIENT_CODES.map((code) => [code, { known: code === "ENERC_KCAL" ? 1 : 0, total: 1 }]),
  ) as Rollup["coverage"];
  return { totals, status, coverage };
}

const RECIPES: PlanRecipeOption[] = [
  {
    recipeId: "r-1",
    name: "Paneer bhurji",
    versionId: "v-1",
    versionNo: 3,
    label: "less oil",
    isCurrent: true,
    servings: 2,
    perServing: perServingRollup(420),
  },
  {
    recipeId: "r-1",
    name: "Paneer bhurji",
    versionId: "v-current",
    versionNo: 2,
    label: null,
    isCurrent: false,
    servings: 2,
    perServing: perServingRollup(500),
  },
];

const FOOD_ENTRY: Entry = {
  id: "e-food",
  foodId: SEED_FOODS[0].id,
  recipeVersionId: null,
  grams: 100,
  amount: 100,
  unit: "g",
  day: "2026-11-15",
  createdAt: "2026-11-15T08:00:00.000Z",
};

const RECIPE_ENTRY: Entry = {
  id: "e-recipe",
  foodId: null,
  recipeVersionId: "v-1",
  grams: 180,
  amount: 1.5,
  unit: "serving",
  day: "2026-11-15",
  createdAt: "2026-11-15T09:00:00.000Z",
};

function setup(overrides: Partial<DiaryProps> = {}) {
  const user = userEvent.setup();
  render(
    <Diary
      foods={SEED_FOODS}
      recipes={RECIPES}
      entries={[]}
      targets={[]}
      day="2026-11-15"
      planned={[]}
      plannedKcal={0}
      {...overrides}
    />,
  );
  return user;
}

beforeEach(() => {
  push.mockReset();
  addFoodAction.mockReset();
  addFoodAction.mockResolvedValue({ ok: true });
  addRecipeEntryAction.mockReset();
  addRecipeEntryAction.mockResolvedValue({ ok: true });
  removeEntryAction.mockReset();
  removeEntryAction.mockResolvedValue({ ok: true });
});

describe("diary: search tabs", () => {
  it("defaults to Foods and shows the food search", () => {
    setup();
    const foodsTab = screen.getByRole("tab", { name: "Foods" });
    expect(foodsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByPlaceholderText(/paneer, palak, dal/i)).toBeInTheDocument();
  });

  it("switches to the recipes tab and lists current versions only", async () => {
    const user = setup();
    await user.click(screen.getByRole("tab", { name: /Recipes/ }));

    expect(screen.getByPlaceholderText(/paneer, palak, dal/i)).toBeInTheDocument();
    expect(screen.getByText("Paneer bhurji")).toBeInTheDocument();
    // the palette must not offer archived versions
    expect(screen.queryByText("v2")).not.toBeInTheDocument();
    expect(screen.getByText(/v3/)).toBeInTheDocument();
  });

  it("filters recipes by name", async () => {
    const user = setup();
    await user.click(screen.getByRole("tab", { name: /Recipes/ }));
    await user.type(screen.getByPlaceholderText(/paneer, palak, dal/i), "zzz-no-match");

    expect(screen.getByText(/No recipes match/)).toBeInTheDocument();
  });
});

describe("diary: logging a recipe", () => {
  it("expands a recipe row into a servings input with a kcal preview", async () => {
    const user = setup();
    await user.click(screen.getByRole("tab", { name: /Recipes/ }));
    await user.click(screen.getByRole("button", { name: /Paneer bhurji/ }));

    const servings = screen.getByLabelText(/Servings/i);
    expect(servings).toHaveValue(1);
    expect(screen.getByText(/pinned to v3/)).toBeInTheDocument();
  });

  it("submits servings to addRecipeEntryAction and closes the editor", async () => {
    const user = setup();
    await user.click(screen.getByRole("tab", { name: /Recipes/ }));
    await user.click(screen.getByRole("button", { name: /Paneer bhurji/ }));
    await user.clear(screen.getByLabelText(/Servings/i));
    await user.type(screen.getByLabelText(/Servings/i), "2");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addRecipeEntryAction).toHaveBeenCalledWith({
      recipeVersionId: "v-1",
      servings: 2,
    }));
    await waitFor(() =>
      expect(screen.queryByLabelText(/Servings/i)).not.toBeInTheDocument(),
    );
  });

  it("rejects a zero servings value without calling the action", async () => {
    const user = setup();
    await user.click(screen.getByRole("tab", { name: /Recipes/ }));
    await user.click(screen.getByRole("button", { name: /Paneer bhurji/ }));
    await user.clear(screen.getByLabelText(/Servings/i));
    await user.type(screen.getByLabelText(/Servings/i), "0");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(addRecipeEntryAction).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a positive number of servings.")).toBeInTheDocument();
    expect(addRecipeEntryAction).not.toHaveBeenCalled();
  });
});

describe("diary: merged logged list", () => {
  it("shows recipe entries with servings and kcal", () => {
    setup({ entries: [RECIPE_ENTRY] });

    expect(screen.getByText(/Paneer bhurji · v3 · less oil/)).toBeInTheDocument();
    expect(screen.getByText("1.5 servings")).toBeInTheDocument();
    // 420 kcal per serving x 1.5
    expect(screen.getByText("630 kcal")).toBeInTheDocument();
  });

  it("shows food and recipe entries together", () => {
    setup({ entries: [FOOD_ENTRY, RECIPE_ENTRY] });

    expect(screen.getAllByText(SEED_FOODS[0].name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Paneer bhurji/).length).toBeGreaterThan(0);
  });

  it("renders an unknown-recipe entry without crashing", () => {
    setup({
      entries: [{ ...RECIPE_ENTRY, recipeVersionId: "v-deleted" }],
    });

    expect(screen.getByText("Deleted recipe")).toBeInTheDocument();
  });
});
