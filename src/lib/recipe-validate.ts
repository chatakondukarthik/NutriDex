import { getFood } from "@/lib/db/foods";
import { computeRecipe, type RecipeBlockInput } from "@/lib/nutrition/recipe";
import { toGrams, MAX_GRAMS, type Unit } from "@/lib/nutrition/units";
import { cleanNote } from "@/lib/notes";
import type { VersionInput } from "@/lib/db/recipes";

/**
 * Draft validation and conversion.
 *
 * Deliberately separate from the repository so it can be tested — and
 * reasoned about — without a database. Nothing here writes anything.
 */

const VALID_UNITS: Unit[] = ["g", "kg", "ml", "l", "portion"];

/**
 * Hard caps on a client-supplied draft.
 *
 * Each input costs a `getFood` query and a per-block compute, and the draft
 * crosses the server-action boundary as untyped JSON. A 16 MB body would
 * otherwise mean hundreds of thousands of synchronous queries.
 */
export const MAX_RECIPE_BLOCKS = 50;
export const MAX_BLOCK_INPUTS = 60;

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
  // The draft crosses the action boundary untyped, so every field is
  // treated as unknown until checked.
  if (!draft || typeof draft !== "object" || typeof draft.name !== "string") {
    return { ok: false, message: "That recipe is not valid." };
  }
  const name = draft.name.trim();
  if (!name) return { ok: false, message: "Give the recipe a name." };
  // Bounds the recipes row: the draft crosses the server-action boundary
  // unvalidated, so a name is rejected (not silently truncated) like the
  // other hard failures in this file.
  if (name.length > 160) return { ok: false, message: "That name is too long." };

  if (!Number.isFinite(draft.servings) || draft.servings <= 0) {
    return { ok: false, message: "Servings must be a positive number." };
  }
  if (draft.servings > 100) {
    return { ok: false, message: "That is a lot of servings. Check the number." };
  }

  if (!Array.isArray(draft.blocks)) {
    return { ok: false, message: "That recipe is not valid." };
  }
  if (draft.blocks.length > MAX_RECIPE_BLOCKS) {
    return { ok: false, message: "That recipe has too many steps." };
  }
  for (const block of draft.blocks) {
    if (!block || !Array.isArray(block.inputs)) {
      return { ok: false, message: "That recipe is not valid." };
    }
    if (block.inputs.length > MAX_BLOCK_INPUTS) {
      return { ok: false, message: "One step has too many ingredients." };
    }
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
      if (typeof input.foodId !== "string") {
        return { ok: false, message: "One of the ingredients is not valid." };
      }
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
        // Bounds the component_inputs row: preparation is free text with
        // no other cap, so a paste is truncated rather than stored whole.
        preparation:
          (typeof input.preparation === "string" ? input.preparation.trim() : "").slice(0, 300) ||
          null,
        // Notes share the app-wide 1000-char ceiling with every other
        // note writer (editor, AI, fragments, graph saves).
        note: cleanNote(input.note) ?? null,
      });
    }

    const outputGrams =
      block.outputGrams != null &&
      Number.isFinite(block.outputGrams) &&
      block.outputGrams > 0 &&
      block.outputGrams <= MAX_GRAMS
        ? block.outputGrams
        : null;

    // Bounds the components row: an untrusted block name is truncated,
    // not rejected — the default still names the step for the user.
    const blockName =
      (typeof block.name === "string" ? block.name.trim() : "").slice(0, 160) ||
      `Step ${blockIndex + 1}`;
    // The operation is written to the component row and the snapshot, so cap
    // it like the graph validator caps a step operation.
    const operation =
      (typeof block.operation === "string" ? block.operation.trim() : "").slice(0, 60) || null;

    blockInputs.push({
      name: blockName,
      operation,
      inputs: lines,
      outputGrams,
    });

    storedBlocks.push({
      name: blockName,
      operation,
      outputGrams,
      inputs: storedInputs,
    });
  }

  const snapshot = computeRecipe(blockInputs, draft.servings);
  const yieldGrams = snapshot.yieldBasis === "measured" ? snapshot.outputGrams : null;

  const versionLabel = typeof draft.versionLabel === "string" ? draft.versionLabel.trim() : "";
  const instructions = typeof draft.instructions === "string" ? draft.instructions.trim() : "";

  return {
    ok: true,
    version: {
      // Bounds the recipe_versions row: label and instructions are both
      // free text straight from the draft, so each is truncated.
      label: versionLabel.slice(0, 80) || null,
      instructions: instructions.slice(0, 10_000),
      servings: draft.servings,
      yieldGrams,
      blocks: storedBlocks,
      snapshot,
    },
  };
}
