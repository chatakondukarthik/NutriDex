import { combine, perServing, rollup, scaleRollup, type Rollup } from "./engine";
import type { NutrientProfile } from "./types";

/**
 * Recipe calculation (D-021, D-022, D-026).
 *
 * A recipe is an ordered list of blocks. Each block has inputs and an
 * optional measured output mass. Blocks are rolled up independently so
 * the UI can show a subtotal per step, then combined for the recipe.
 *
 * The rule that keeps this honest: a measured output mass changes the
 * per-100 g figure and nothing else. The absolute amount of protein in
 * the pan does not change because water boiled off.
 */

export const CALCULATION_VERSION = "1";

export interface RecipeLine {
  label: string;
  profile: NutrientProfile;
  grams: number;
}

export interface RecipeBlockInput {
  name: string;
  operation?: string | null;
  inputs: RecipeLine[];
  /** Mass after the operation, if the user weighed it. */
  outputGrams?: number | null;
}

export interface BlockResult {
  name: string;
  operation: string | null;
  inputGrams: number;
  outputGrams: number | null;
  result: Rollup;
}

/**
 * `measured` — the final step has a weighed output.
 * `partial`  — an intermediate step does, but the final one does not.
 * `none`     — nothing was weighed; totals are still exact.
 */
export type YieldBasis = "measured" | "partial" | "none";

export interface RecipeResult {
  blocks: BlockResult[];
  total: Rollup;
  perServing: Rollup;
  /** Only when the yield basis is `measured`. */
  per100g: Rollup | null;
  servings: number;
  inputGrams: number;
  outputGrams: number | null;
  yieldBasis: YieldBasis;
  calculationVersion: string;
}

export function computeRecipe(blocks: RecipeBlockInput[], servings: number): RecipeResult {
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new Error("Servings must be a positive number.");
  }

  const blockResults: BlockResult[] = blocks.map((block) => ({
    name: block.name,
    operation: block.operation ?? null,
    inputGrams: block.inputs.reduce((sum, line) => sum + line.grams, 0),
    outputGrams: validMass(block.outputGrams),
    result: rollup(
      block.inputs.map((line) => ({
        label: line.label,
        profile: line.profile,
        grams: line.grams,
      })),
    ),
  }));

  const total = combine(blockResults.map((block) => block.result));

  /**
   * The dish's cooked mass is the output of the *final* step. Earlier
   * steps are intermediate: nobody weighs the pan between every stage,
   * and an intermediate mass says nothing about the finished dish.
   */
  const finalBlock = blockResults.at(-1);
  const outputGrams = finalBlock?.outputGrams ?? null;
  const intermediateMeasured = blockResults
    .slice(0, -1)
    .some((block) => block.outputGrams != null);

  const yieldBasis: YieldBasis =
    outputGrams != null ? "measured" : intermediateMeasured ? "partial" : "none";

  return {
    blocks: blockResults,
    total,
    perServing: perServing(total, servings),
    per100g: outputGrams && outputGrams > 0 ? scaleRollup(total, 100 / outputGrams) : null,
    servings,
    inputGrams: blockResults.reduce((sum, block) => sum + block.inputGrams, 0),
    outputGrams,
    yieldBasis,
    calculationVersion: CALCULATION_VERSION,
  };
}

function validMass(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Plain-language description of the yield assumption, for the review
 * screen. D-026 requires the assumption to be disclosed, not implied.
 */
export function yieldNote(result: RecipeResult): string {
  switch (result.yieldBasis) {
    case "measured":
      return `Per 100 g uses your measured ${round(result.outputGrams ?? 0)} g output.`;
    case "partial":
      return "An intermediate step has a measured output but the final step does not, so a recipe-level per-100 g figure is not shown.";
    case "none":
      return "No output mass recorded, so raw and cooked mass are treated as equal. Totals are unaffected.";
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
