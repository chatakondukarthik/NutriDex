/**
 * Filtering for the recipes browser.
 *
 * A recipe matches a query when the query is a substring of the recipe's
 * name **or of any ingredient it uses** (name or alias, case-insensitive).
 * The ingredient dropdown narrows to recipes containing a specific food.
 * Both constraints compose (AND).
 */

export interface FilterableRecipe {
  id: string;
  name: string;
  /** Lowercased haystack: recipe name plus ingredient names and aliases. */
  haystack: string;
  /** Food ids used in the current version of the recipe. */
  ingredientIds: string[];
}

export interface IngredientFacet {
  id: string;
  name: string;
  count: number;
}

/** Distinct ingredients used across all given recipes, with usage counts. */
export function ingredientFacets(
  recipes: FilterableRecipe[],
  names: Map<string, string>,
): IngredientFacet[] {
  const counts = new Map<string, number>();
  for (const recipe of recipes) {
    for (const id of new Set(recipe.ingredientIds)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: names.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function filterRecipes<T extends FilterableRecipe>(
  recipes: T[],
  query: string,
  ingredientId: string | null,
): T[] {
  const q = query.trim().toLowerCase();
  return recipes.filter((recipe) => {
    if (ingredientId && !recipe.ingredientIds.includes(ingredientId)) return false;
    if (!q) return true;
    return recipe.haystack.includes(q);
  });
}
