import type { Food } from "./types";

/**
 * Deliberately simple search: case-insensitive prefix and substring matching
 * over the name and aliases. Good enough for a personal food list, and a known
 * limitation for later — see docs/research/RESEARCH.md.
 *
 * Pure on purpose: the caller already holds the list (a page read it, a
 * client component received it as a prop), and keeping the function free of
 * database imports means it can run in the browser.
 */
export function searchFoods(foods: Food[], query: string): Food[] {
  const q = query.trim().toLowerCase();
  if (!q) return foods;

  const scored = foods
    .map((food) => {
      const name = food.name.toLowerCase();
      const aliases = food.aliases.map((alias) => alias.toLowerCase());

      if (name === q) return { food, score: 0 };
      if (name.startsWith(q)) return { food, score: 1 };
      if (aliases.some((alias) => alias === q)) return { food, score: 2 };
      if (aliases.some((alias) => alias.startsWith(q))) return { food, score: 3 };
      if (name.includes(q)) return { food, score: 4 };
      if (aliases.some((alias) => alias.includes(q))) return { food, score: 5 };
      return null;
    })
    .filter((entry): entry is { food: Food; score: number } => entry !== null);

  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.food);
}
