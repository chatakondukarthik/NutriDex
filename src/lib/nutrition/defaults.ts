/**
 * What a food pre-fills with when it is added to a plan, diary, recipe
 * or canvas — "how much of this do I usually take?".
 *
 * Pure: no database, no network, safe on client and server. The caller
 * supplies the two stored candidates (a user pin and the last amount
 * used); everything below them is derived from the food record itself,
 * so a food imported tomorrow gets a sensible default with no code
 * changes:
 *
 *   pin → last-used → portion → serving size → name/category rules → 100 g
 *
 * Stored candidates are validated before use: a pin pointing at a
 * portion the food no longer has is ignored rather than crashing the
 * add. The rules are patterns, not a per-food list — "oil" catches
 * mustard oil, sesame oil, and any oil added later.
 */

import type { Food } from "./types";
import { UNITS, findPortion, parseUnitKey } from "./units";

export type DefaultSource =
  | "pin"
  | "last-used"
  | "portion"
  | "serving"
  | "rule"
  | "fallback";

export interface DefaultAmount {
  amount: number;
  /** Unit key: a universal unit ("g", "tbsp"…) or `portion:<label>`. */
  unit: string;
  source: DefaultSource;
}

export interface StoredAmount {
  amount: number;
  unit: string;
}

const UNIVERSAL_UNITS = new Set(UNITS.map((unit) => unit.value));

/** A stored amount only counts if it is still usable for this food. */
function usable(food: Food, candidate: StoredAmount | null | undefined): StoredAmount | null {
  if (!candidate) return null;
  const { amount, unit } = candidate;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  if (typeof unit !== "string" || unit.length === 0) return null;
  const parsed = parseUnitKey(unit);
  if (parsed.unit === "portion") {
    if (!parsed.portionLabel || !findPortion(food, parsed.portionLabel)) return null;
    return { amount, unit };
  }
  if (!UNIVERSAL_UNITS.has(parsed.unit)) return null;
  return { amount, unit };
}

interface Rule {
  test: (name: string, category: string) => boolean;
  amount: number;
  unit: string;
}

/**
 * The safety net for foods with no portions and no serving size. Only
 * the items where 100 g would be absurd get a rule — energy-dense or
 * potent things measured by the spoon. Everything else keeps the
 * 100 g floor, which is correct for most solids (paneer, rice, veg).
 *
 * Order matters: powders before wet condiments, so "peanut chutney
 * powder" lands on a teaspoon rather than a tablespoon.
 */
const RULES: Rule[] = [
  {
    test: (name) => /\b(powder|masala mix|seasoning mix)\b/.test(name),
    amount: 1,
    unit: "tsp",
  },
  {
    test: (name, category) =>
      /\b(oil|ghee|butter|margarine|shortening)\b/.test(name) ||
      /\bfats?\b|\boils?\b/.test(category),
    amount: 1,
    unit: "tbsp",
  },
  {
    test: (name, category) =>
      /\b(salt|masala|spice|spices|seasoning|turmeric|cumin|coriander|chilli|chili|paprika|pepper|garam|saffron|oregano|thyme|yeast)\b/.test(
        name,
      ) || /\bspices?\b|\bherbs?\b|\bseasonings?\b/.test(category),
    amount: 1,
    unit: "tsp",
  },
  {
    test: (name, category) =>
      /\b(sugar|honey|jaggery|syrup|molasses)\b/.test(name) || /\bsugars?\b/.test(category),
    amount: 1,
    unit: "tbsp",
  },
  {
    test: (name) =>
      /\b(ketchup|sauce|mayonnaise|mayo|chutney|pickle|jam|relish)\b/.test(name),
    amount: 1,
    unit: "tbsp",
  },
  {
    test: (name, category) =>
      /\b(milk|water|tea|coffee|juice|lassi|buttermilk|shake|smoothie|drink)\b/.test(
        name,
      ) || /\bbeverages?\b|\bdrinks?\b/.test(category),
    amount: 1,
    unit: "cup",
  },
];

export interface DefaultAmountCandidates {
  /** User-pinned default from the food editor; beats everything. */
  pin?: StoredAmount | null;
  /** Most recently used amount+unit for this food anywhere in the app. */
  lastUsed?: StoredAmount | null;
}

export function defaultAmountFor(
  food: Food,
  candidates: DefaultAmountCandidates = {},
): DefaultAmount {
  const pinned = usable(food, candidates.pin);
  if (pinned) return { ...pinned, source: "pin" };

  const lastUsed = usable(food, candidates.lastUsed);
  if (lastUsed) return { ...lastUsed, source: "last-used" };

  // The food's own household measures: "1 banana", "1 katori", "1 glass".
  if (food.portions.length > 0) {
    const chosen =
      food.portions.find((portion) => /^1[\s(]/.test(portion.label)) ?? food.portions[0];
    return { amount: 1, unit: `portion:${chosen.label}`, source: "portion" };
  }

  if (food.servingSizeG != null && Number.isFinite(food.servingSizeG) && food.servingSizeG > 0) {
    return { amount: food.servingSizeG, unit: "g", source: "serving" };
  }

  const name = food.name;
  const category = food.category ?? "";
  for (const rule of RULES) {
    if (rule.test(name, category)) return { amount: rule.amount, unit: rule.unit, source: "rule" };
  }

  return { amount: 100, unit: "g", source: "fallback" };
}
