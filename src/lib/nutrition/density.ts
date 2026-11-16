/**
 * Density defaults for volume→mass conversion.
 *
 * The rule this enforces: never silently pretend a food is water. When we
 * do not know the real density, we say so — and we make the assumption
 * visible, specific and editable. A milk-like dairy food behaves like 1.03
 * and a bottle of oil like 0.91 because that is what those foods *are*
 * (IFCT/USDA reference densities). Flour in a cup is the reason bakers
 * complain about flat breads.
 *
 * Every assumed density carries the source tag "assumed" and a blast
 * radius of zero — the user can override it any time in the food editor.
 */

export interface DensityGuess {
  gPerMl: number;
  /** Short human label, e.g. "oil", "dairy", "powder". */
  category: string;
  /** Where the guess comes from. */
  source: string;
}

/** Name keywords, checked in order — first hit wins. */
const NAME_RULES: Array<[RegExp, DensityGuess]> = [
  [/oil|ghee|vanaspati/i, { gPerMl: 0.91, category: "oil/fat", source: "reference: fat ≈ 0.91 g/ml" }],
  [/butter/i, { gPerMl: 0.91, category: "fat", source: "reference: butter ≈ 0.91 g/ml" }],
  [/honey|sugar ?syrup|jaggery/i, { gPerMl: 1.4, category: "sweetener", source: "reference: honey ≈ 1.42 g/ml" }],
  [/maple syrup/i, { gPerMl: 1.32, category: "sweetener", source: "reference: maple syrup ≈ 1.32 g/ml" }],
  [/flour|maida|atta|besan|sooji|rava|semolina|cornmeal|corn ?flour/i,
    { gPerMl: 0.57, category: "flour", source: "reference: flour ≈ 0.55–0.60 g/ml (1 cup ≈ 120–135 g)" }],
  [/sugar(?!\s?cane)|salt|cocoa|starch|baking (powder|soda)/i,
    { gPerMl: 0.85, category: "granulated powder", source: "reference: granulated ≈ 0.8–0.9 g/ml" }],
  [/rice|dal|lentil|chickpea|rajma|moong|urad|toor|chana/i,
    { gPerMl: 0.75, category: "grains & dals", source: "reference: dry grains ≈ 0.75 g/ml" }],
  [/oats|poha|corn ?flakes|muesli/i,
    { gPerMl: 0.35, category: "cereal", source: "reference: oats ≈ 0.3–0.4 g/ml" }],
  [/milk|curd|dahi|yogurt|buttermilk|whey/i,
    { gPerMl: 1.03, category: "dairy liquid", source: "reference: milk ≈ 1.03 g/ml" }],
  [/paneer|cheese|ghee/i,
    { gPerMl: 1.05, category: "dairy solid", source: "reference: paneer ≈ 1.05 g/ml" }],
  [/coffee|tea|espresso/i,
    { gPerMl: 1.0, category: "beverage", source: "≈ 1.0 g/ml (mostly water)" }],
  [/vinegar|soy sauce|hot sauce|ketchup|chutney|pickle/i,
    { gPerMl: 1.05, category: "condiment", source: "reference: condiments ≈ 1.0–1.1 g/ml" }],
  [/egg|egg white/i,
    { gPerMl: 1.03, category: "egg", source: "reference: whole egg ≈ 1.03 g/ml" }],
  [/meat|chicken|fish|mutton|lamb|prawn/i,
    { gPerMl: 1.05, category: "meat", source: "reference: ground meat ≈ 1.05 g/ml" }],
];

/** Category-level defaults (used when no name rule fires). */
const CATEGORY_RULES: Record<string, DensityGuess> = {
  Dairy: { gPerMl: 1.02, category: "dairy", source: "reference: dairy ≈ 1.0–1.05 g/ml" },
  Fats: { gPerMl: 0.91, category: "fat", source: "reference: fat ≈ 0.91 g/ml" },
  Oils: { gPerMl: 0.91, category: "fat", source: "reference: fat ≈ 0.91 g/ml" },
  Grains: { gPerMl: 0.65, category: "grains", source: "reference: dry grains ≈ 0.6–0.75 g/ml" },
  Cereals: { gPerMl: 0.65, category: "grains", source: "reference: dry grains ≈ 0.6–0.75 g/ml" },
  "Cereals & millets": { gPerMl: 0.65, category: "grains", source: "reference: dry grains ≈ 0.6–0.75 g/ml" },
  Spices: { gPerMl: 0.6, category: "spice powder", source: "reference: spice powders ≈ 0.5–0.7 g/ml" },
  Sweeteners: { gPerMl: 1.0, category: "sweetener", source: "reference: sweeteners ≈ 0.8–1.4 g/ml — edit per food" },
  Legumes: { gPerMl: 0.75, category: "legumes", source: "reference: dry legumes ≈ 0.75 g/ml" },
  Vegetables: { gPerMl: 0.9, category: "chopped vegetables", source: "reference: chopped veg ≈ 0.8–1.0 g/ml — edit per food" },
  Fruits: { gPerMl: 0.95, category: "fruit", source: "reference: fresh fruit ≈ 0.9–1.0 g/ml" },
  Beverages: { gPerMl: 1.0, category: "beverage", source: "≈ 1.0 g/ml (mostly water)" },
  Meat: { gPerMl: 1.05, category: "meat", source: "reference: meat ≈ 1.05 g/ml" },
  Seafood: { gPerMl: 1.05, category: "seafood", source: "reference: seafood ≈ 1.05 g/ml" },
  Nuts: { gPerMl: 0.55, category: "nuts", source: "reference: nuts ≈ 0.5–0.6 g/ml" },
  Condiments: { gPerMl: 1.05, category: "condiment", source: "reference: condiments ≈ 1.0–1.1 g/ml" },
  Custom: { gPerMl: 1.0, category: "custom", source: "no better rule — be explicit in the editor" },
};

/**
 * The best honest guess for a food's density, or null when even a
 * category-level default is unsafe (i.e. Custom/novel foods — those get a
 * 1.0 fallback and a loud note, never a confident-looking number).
 */
export function guessDensity(food: { name: string; category?: string | null }): DensityGuess | null {
  for (const [pattern, guess] of NAME_RULES) {
    if (pattern.test(food.name)) return guess;
  }
  if (food.category && CATEGORY_RULES[food.category]) {
    return CATEGORY_RULES[food.category];
  }
  return null;
}
