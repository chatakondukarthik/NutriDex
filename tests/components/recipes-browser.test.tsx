import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecipesBrowser, type Recipe } from "@/components/recipes-browser";
import { ThemeProvider } from "@/components/theme-provider";
import { DEFAULT_THEME } from "@/lib/theme";

function makeRecipe(overrides: Partial<Recipe> & Pick<Recipe, "id" | "name">): Recipe {
  return {
    currentVersionNo: 1,
    currentVersionLabel: null,
    kcalPerServing: 350,
    servings: 2,
    versionCount: 1,
    kind: "dish",
    ingredientIds: [],
    ingredients: [],
    haystack: overrides.name.toLowerCase(),
    ...overrides,
  };
}

const paneer = { id: "paneer", name: "Paneer" };
const onion = { id: "onion", name: "Onion" };
const toor = { id: "toor-dal", name: "Toor dal" };
const curd = { id: "curd", name: "Curd" };
const tomato = { id: "tomato", name: "Tomato" };

const RECIPES: Recipe[] = [
  makeRecipe({
    id: "r1",
    name: "Paneer bhurji",
    currentVersionNo: 3,
    currentVersionLabel: "less oil",
    ingredientIds: ["paneer", "onion", "tomato"],
    ingredients: [paneer, onion, tomato],
    haystack: "paneer bhurji paneer onion tomato",
  }),
  makeRecipe({
    id: "r2",
    name: "Dal tadka",
    ingredientIds: ["toor-dal", "onion"],
    ingredients: [toor, onion],
    haystack: "dal tadka toor dal onion",
  }),
  makeRecipe({
    id: "r3",
    name: "Paneer tikka",
    kind: "dish",
    ingredientIds: ["paneer", "curd"],
    ingredients: [paneer, curd],
    haystack: "paneer tikka paneer curd",
  }),
];

describe("recipes browser: ingredient search", () => {
  it("matches recipes by ingredient name typed into the search box", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider initial={DEFAULT_THEME}><RecipesBrowser recipes={RECIPES} /></ThemeProvider>);

    await user.type(screen.getByPlaceholderText(/search recipes or ingredients/i), "paneer");

    expect(screen.getByText("Paneer bhurji")).toBeInTheDocument();
    expect(screen.getByText("Paneer tikka")).toBeInTheDocument();
    expect(screen.queryByText("Dal tadka")).not.toBeInTheDocument();
  });

  it("matches recipes by a non-name ingredient like its food alias", async () => {
    const user = userEvent.setup();
    const withAliases = RECIPES.map((recipe) =>
      recipe.id === "r2" ? { ...recipe, haystack: "dal tadka toor dal onion tur dal" } : recipe,
    );
    render(<ThemeProvider initial={DEFAULT_THEME}><RecipesBrowser recipes={withAliases} /></ThemeProvider>);

    await user.type(screen.getByPlaceholderText(/search recipes or ingredients/i), "tur dal");
    expect(screen.getByText("Dal tadka")).toBeInTheDocument();
    expect(screen.queryByText("Paneer bhurji")).not.toBeInTheDocument();
  });

  it("filters by the ingredient dropdown, with counts", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider initial={DEFAULT_THEME}><RecipesBrowser recipes={RECIPES} /></ThemeProvider>);

    const dropdown = screen.getByLabelText(/filter by ingredient/i);
    expect(dropdown).toHaveTextContent("Onion (2)");

    await user.selectOptions(dropdown, "paneer");
    expect(screen.getByText("Paneer bhurji")).toBeInTheDocument();
    expect(screen.getByText("Paneer tikka")).toBeInTheDocument();
    expect(screen.queryByText("Dal tadka")).not.toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("composes query and ingredient dropdown (AND)", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider initial={DEFAULT_THEME}><RecipesBrowser recipes={RECIPES} /></ThemeProvider>);

    await user.selectOptions(screen.getByLabelText(/filter by ingredient/i), "onion");
    await user.type(screen.getByPlaceholderText(/search recipes or ingredients/i), "tikka");
    expect(screen.queryByText("Paneer tikka")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText(/search recipes or ingredients/i));
    await user.type(screen.getByPlaceholderText(/search recipes or ingredients/i), "bhurji");
    expect(screen.getByText("Paneer bhurji")).toBeInTheDocument();
  });

  it("sets the ingredient filter when a chip on a card is clicked", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider initial={DEFAULT_THEME}><RecipesBrowser recipes={RECIPES} /></ThemeProvider>);

    const chip = screen.getAllByRole("button", { name: "Paneer" })[0];
    await user.click(chip);

    expect(screen.getByLabelText(/filter by ingredient/i)).toHaveValue("paneer");
    expect(screen.getByText("Paneer bhurji")).toBeInTheDocument();
    expect(screen.queryByText("Dal tadka")).not.toBeInTheDocument();
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a clear message when nothing matches", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider initial={DEFAULT_THEME}><RecipesBrowser recipes={RECIPES} /></ThemeProvider>);

    await user.type(screen.getByPlaceholderText(/search recipes or ingredients/i), "zzzz");
    expect(screen.getByText(/No recipes match/)).toBeInTheDocument();
  });
});

describe("recipes browser: origin filter", () => {
  const withOrigin = [
    ...RECIPES,
    makeRecipe({
      id: "r-ai",
      name: "AI grain bowl",
      kind: "dish",
      currentVersionLabel: "ai",
      haystack: "ai grain bowl ai",
    }),
    makeRecipe({
      id: "r-preset",
      name: "Preset pulao",
      kind: "dish",
      currentVersionLabel: "preset",
      haystack: "preset pulao preset",
    }),
  ];

  it("AI-designed shows only AI-labelled recipes", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initial={DEFAULT_THEME}>
        <RecipesBrowser recipes={withOrigin} />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "AI-designed" }));
    expect(screen.getByText("AI grain bowl")).toBeInTheDocument();
    expect(screen.queryByText("Paneer bhurji")).toBeNull();
    expect(screen.queryByText("Preset pulao")).toBeNull();
  });

  it("Preset shows only preset-labelled recipes", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initial={DEFAULT_THEME}>
        <RecipesBrowser recipes={withOrigin} />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Preset" }));
    expect(screen.getByText("Preset pulao")).toBeInTheDocument();
    expect(screen.queryByText("AI grain bowl")).toBeNull();
  });

  it("All restores the full list after filtering", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initial={DEFAULT_THEME}>
        <RecipesBrowser recipes={withOrigin} />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "AI-designed" }));
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("AI grain bowl")).toBeInTheDocument();
    expect(screen.getByText("Paneer bhurji")).toBeInTheDocument();
    expect(screen.getByText("Preset pulao")).toBeInTheDocument();
  });
});
