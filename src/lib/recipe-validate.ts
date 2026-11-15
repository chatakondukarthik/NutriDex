import { getFood } from "@/lib/db/foods";
import { computeRecipe, type RecipeBlockInput } from "@/lib/nutrition/recipe";
import { toGrams, type Unit } from "@/lib/nutrition/units";
import type { VersionInput } from "@/lib/db/recipes";

/**
 * Draft validation and conversion.
 *
 * Deliberately separate from the repository so it can be tested — and
 * reasoned about — without a database. Nothing here writes anything.
 */

const VALID_UNITS: Unit[] = ["g", "kg", "ml", "l", "portion"];

export interface RecipeDraft {
  recipeId?: string | null;
  name: string;
  /** Optional human name for this version ("less salt", "trial 2"). */
  versionLabel?: string | null;
  instructions: string;
  servings: number;
  blocks: Array<{
    name?: string;
    operation?: string | null;
    outputGrams?: number | null;
    inputs: Array<{
      foodId: string;
      amount: number;
      unit: string;
      portionLabel?: string | null;
      preparation?: string | null;
      note?: string | null;
    }>;
  }>;
}

export type PrepareResult =
  | { ok: true; version: VersionInput }
  | { ok: false; message: string };

export function prepareVersion(draft: RecipeDraft): PrepareResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, message: "Give the recipe a name." };

  if (!Number.isFinite(draft.servings) || draft.servings <= 0) {
    return { ok: false, message: "Servings must be a positive number." };
  }
  if (draft.servings > 100) {
    return { ok: false, message: "That is a lot of servings. Check the number." };
  }

  const blocks = draft.blocks.filter((block) => block.inputs.length > 0);
  if (blocks.length === 0) {
    return { ok: false, message: "Add at least one ingredient." };
  }

  const blockInputs: RecipeBlockInput[] = [];
  const storedBlocks: VersionInput["blocks"] = [];

  for (const [blockIndex, block] of blocks.entries()) {
    const lines: RecipeBlockInput["inputs"] = [];
    const storedInputs: VersionInput["blocks"][number]["inputs"] = [];

    for (const input of block.inputs) {
      const food = getFood(input.foodId);
      if (!food) {
        return { ok: false, message: "One of the ingredients is no longer available." };
      }

      if (!VALID_UNITS.includes(input.unit as Unit)) {
        return { ok: false, message: `Unsupported unit for ${food.name}.` };
      }

      const converted = toGrams(food, {
        amount: input.amount,
        unit: input.unit as Unit,
        portionLabel: input.portionLabel ?? undefined,
      });

      if (!converted.ok) {
        return { ok: false, message: `${food.name}: ${converted.reason}` };
      }

      lines.push({ label: food.name, profile: food.nutrients, grams: converted.grams });
      storedInputs.push({
        foodId: food.id,
        grams: converted.grams,
        amount: input.amount,
        // Keep the user's unit intact, including which named portion.
        unit:
          input.unit === "portion" && input.portionLabel
            ? `portion:${input.portionLabel}`
            : input.unit,
        preparation: input.preparation?.trim() || null,
        note: input.note?.trim() || null,
      });
    }

    const outputGrams =
      block.outputGrams != null && Number.isFinite(block.outputGrams) && block.outputGrams > 0
        ? block.outputGrams
        : null;

    const blockName = block.name?.trim() || `Step ${blockIndex + 1}`;

    blockInputs.push({
      name: blockName,
      operation: block.operation?.trim() || null,
      inputs: lines,
      outputGrams,
    });

    storedBlocks.push({
      name: blockName,
      operation: block.operation?.trim() || null,
      outputGrams,
      inputs: storedInputs,
    });
  }

  const snapshot = computeRecipe(blockInputs, draft.servings);
  const yieldGrams = snapshot.yieldBasis === "measured" ? snapshot.outputGrams : null;

  return {
    ok: true,
    version: {
      label: draft.versionLabel?.trim() || null,
      instructions: draft.instructions.trim(),
      servings: draft.servings,
      yieldGrams,
      blocks: storedBlocks,
      snapshot,
    },
  };
}
