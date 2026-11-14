import type { RecipeDraft } from "@/lib/recipe-validate";

/**
 * Preset recipes.
 *
 * These are *templates*, not rows in the database: starting from a preset
 * prefills the builder and the user saves their own version. That keeps
 * the library honest — everything in it was saved by the user — while
 * still giving a first-time user something to edit rather than a blank
 * page.
 *
 * Food ids refer to the seed dataset in `foods.ts`.
 */

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  draft: Omit<RecipeDraft, "recipeId">;
}

export const PRESETS: Preset[] = [
  {
    id: "paneer-bhurji",
    name: "Paneer bhurji",
    blurb: "Scrambled paneer with onion and tomato. Two servings.",
    draft: {
      name: "Paneer bhurji",
      servings: 2,
      instructions:
        "1. Dice the onion and tomato.\n2. Heat the oil, fry the onion until translucent.\n3. Add the tomato and cook until it breaks down.\n4. Crumble in the paneer, season, and stir for two minutes.\n5. Serve hot with roti.",
      blocks: [
        {
          name: "Prep",
          operation: "dice",
          inputs: [
            { foodId: "onion", amount: 100, unit: "g", preparation: "raw, diced" },
            { foodId: "tomato", amount: 100, unit: "g", preparation: "raw, diced" },
          ],
        },
        {
          name: "Cook",
          operation: "fry",
          inputs: [
            { foodId: "mustard-oil", amount: 10, unit: "g", preparation: null },
            { foodId: "paneer", amount: 200, unit: "g", preparation: "crumbled" },
            { foodId: "salt", amount: 1, unit: "portion", portionLabel: "1 pinch", preparation: null },
          ],
        },
      ],
    },
  },
  {
    id: "dal-tadka",
    name: "Dal tadka",
    blurb: "Toor dal with a ghee tempering. Three servings.",
    draft: {
      name: "Dal tadka",
      servings: 3,
      instructions:
        "1. Rinse the dal and boil with the tomato until soft.\n2. Heat the ghee and fry the onion until golden.\n3. Pour the tempering over the dal, add salt, and simmer for five minutes.",
      blocks: [
        {
          name: "Boil",
          operation: "boil",
          inputs: [
            { foodId: "toor-dal", amount: 100, unit: "g", preparation: "rinsed" },
            { foodId: "tomato", amount: 80, unit: "g", preparation: "raw, quartered" },
          ],
        },
        {
          name: "Temper",
          operation: "fry",
          inputs: [
            { foodId: "ghee", amount: 8, unit: "g", preparation: null },
            { foodId: "onion", amount: 60, unit: "g", preparation: "sliced" },
            { foodId: "salt", amount: 1, unit: "portion", portionLabel: "1 pinch", preparation: null },
          ],
        },
      ],
    },
  },
  {
    id: "rajma-masala",
    name: "Rajma masala",
    blurb: "Kidney beans in an onion-tomato base. Three servings.",
    draft: {
      name: "Rajma masala",
      servings: 3,
      instructions:
        "1. Soak the rajma overnight and pressure cook until soft.\n2. Fry the onion in oil, add the tomato, and cook down.\n3. Add the rajma with its cooking liquid and simmer for twenty minutes.",
      blocks: [
        {
          name: "Base",
          operation: "fry",
          inputs: [
            { foodId: "mustard-oil", amount: 8, unit: "g", preparation: null },
            { foodId: "onion", amount: 80, unit: "g", preparation: "chopped" },
            { foodId: "tomato", amount: 80, unit: "g", preparation: "pureed" },
          ],
        },
        {
          name: "Simmer",
          operation: "boil",
          inputs: [
            { foodId: "rajma", amount: 100, unit: "g", preparation: "soaked, cooked" },
            { foodId: "salt", amount: 1, unit: "portion", portionLabel: "1 pinch", preparation: null },
          ],
        },
      ],
    },
  },
];

export function getPreset(id: string | undefined): Preset | undefined {
  if (!id) return undefined;
  return PRESETS.find((preset) => preset.id === id);
}
