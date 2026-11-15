import { describe, expect, it } from "vitest";
import { filterRecipes, ingredientFacets, type FilterableRecipe } from "@/lib/recipe-filter";

const RECIPES: FilterableRecipe[] = [
  { id: "r1", name: "Paneer bhurji", haystack: "paneer bhurji paneer onion tomato", ingredientIds: ["paneer", "onion", "tomato"] },
  { id: "r2", name: "Dal tadka", haystack: "dal tadka toor dal onion", ingredientIds: ["toor-dal", "onion"] },
  { id: "r3", name: "Paneer tikka", haystack: "paneer tikka paneer yogurt spices", ingredientIds: ["paneer", "curd"] },
];

describe("filterRecipes", () => {
  it("matches on recipe name", () => {
    expect(filterRecipes(RECIPES, "bhurji", null).map((r) => r.id)).toEqual(["r1"]);
  });

  it("matches on ingredient name", () => {
    expect(filterRecipes(RECIPES, "toor", null).map((r) => r.id)).toEqual(["r2"]);
    expect(filterRecipes(RECIPES, "paneer", null).map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("is case-insensitive and trims", () => {
    expect(filterRecipes(RECIPES, "  PANEER ", null)).toHaveLength(2);
  });

  it("narrows by ingredient dropdown", () => {
    expect(filterRecipes(RECIPES, "", "paneer").map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(filterRecipes(RECIPES, "", "onion").map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("composes query and ingredient (AND)", () => {
    expect(filterRecipes(RECIPES, "tikka", "paneer").map((r) => r.id)).toEqual(["r3"]);
    expect(filterRecipes(RECIPES, "tikka", "onion")).toEqual([]);
  });

  it("returns everything for an empty query and no ingredient", () => {
    expect(filterRecipes(RECIPES, "", null)).toHaveLength(3);
  });
});

describe("ingredientFacets", () => {
  it("counts usage, sorted by frequency then name", () => {
    const names = new Map([
      ["paneer", "Paneer"],
      ["onion", "Onion"],
      ["toor-dal", "Toor dal"],
      ["curd", "Curd"],
      ["tomato", "Tomato"],
    ]);
    const facets = ingredientFacets(RECIPES, names);
    expect(facets.map((f) => [f.id, f.count])).toEqual([
      ["onion", 2],
      ["paneer", 2],
      ["curd", 1],
      ["tomato", 1],
      ["toor-dal", 1],
    ]);
  });
});
