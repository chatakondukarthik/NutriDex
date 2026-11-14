import type { Food } from "@/lib/nutrition/types";
import { toGrams, type GramResult, type Unit } from "@/lib/nutrition/units";
import { computeRecipe, type RecipeBlockInput, type RecipeResult } from "@/lib/nutrition/recipe";
import type { RecipeDraft } from "@/lib/recipe-validate";
import type { RecipeVersionDetail } from "@/lib/db/recipes";

/**
 * The builder's state, and the pure functions that move between it and
 * the shapes the server understands.
 *
 * Kept out of the component file so it can be imported by server pages
 * (which cannot call functions exported from a `"use client"` module) and
 * so the conversions are testable without a DOM.
 */

export const OPERATIONS = [
  "grate",
  "dice",
  "slice",
  "chop",
  "boil",
  "fry",
  "sauté",
  "bake",
  "grill",
  "mix",
  "assemble",
] as const;

export interface BuilderInput {
  key: string;
  foodId: string;
  amount: string;
  unitKey: string;
  preparation: string;
  note: string;
}

export interface BuilderBlock {
  key: string;
  name: string;
  operation: string;
  outputGrams: string;
  inputs: BuilderInput[];
}

export interface BuilderState {
  name: string;
  instructions: string;
  servings: string;
  blocks: BuilderBlock[];
}

export function newKey(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `k${Math.random().toString(36).slice(2)}`;
}

export function emptyInput(foodId = ""): BuilderInput {
  return {
    key: newKey(),
    foodId,
    amount: "100",
    unitKey: "g",
    preparation: "",
    note: "",
  };
}

export function emptyBlock(name = "Ingredients"): BuilderBlock {
  return {
    key: newKey(),
    name,
    operation: "",
    outputGrams: "",
    inputs: [emptyInput()],
  };
}

export function emptyBuilder(): BuilderState {
  return {
    name: "",
    instructions: "",
    servings: "2",
    blocks: [emptyBlock()],
  };
}

export function builderFromDraft(draft: Omit<RecipeDraft, "recipeId">): BuilderState {
  return {
    name: draft.name,
    instructions: draft.instructions,
    servings: String(draft.servings),
    blocks: draft.blocks.map((block, index) => ({
      key: newKey(),
      name: block.name ?? `Step ${index + 1}`,
      operation: block.operation ?? "",
      outputGrams: block.outputGrams == null ? "" : String(block.outputGrams),
      inputs: block.inputs.map((input) => ({
        key: newKey(),
        foodId: input.foodId,
        amount: String(input.amount),
        unitKey:
          input.unit === "portion" && input.portionLabel
            ? `portion:${input.portionLabel}`
            : input.unit,
        preparation: input.preparation ?? "",
        note: input.note ?? "",
      })),
    })),
  };
}

export function builderFromVersion(version: RecipeVersionDetail): BuilderState {
  return {
    name: version.recipeName,
    instructions: version.instructions,
    servings: String(version.servings),
    blocks: version.blocks.map((block) => ({
      key: block.id,
      name: block.name,
      operation: block.operation ?? "",
      outputGrams: block.outputGrams == null ? "" : String(block.outputGrams),
      inputs: block.inputs.map((input) => ({
        key: input.id,
        foodId: input.foodId,
        amount: String(input.amount),
        unitKey: input.unit,
        preparation: input.preparation ?? "",
        note: input.note ?? "",
      })),
    })),
  };
}

export function parseUnitKey(key: string): { unit: Unit; portionLabel?: string } {
  if (key.startsWith("portion:")) {
    return { unit: "portion", portionLabel: key.slice("portion:".length) };
  }
  return { unit: key as Unit };
}

export function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** The unit options for a food, matching what the diary offers. */
export function unitOptions(food: Food | undefined): { value: string; label: string }[] {
  const base = [
    { value: "g", label: "g" },
    { value: "ml", label: "ml" },
  ];
  if (!food) return base;
  return [...base, ...food.portions.map((p) => ({ value: `portion:${p.label}`, label: p.label }))];
}

export function inputGrams(food: Food | undefined, input: BuilderInput): GramResult {
  if (!food) return { ok: false, reason: "Choose a food first." };
  const { unit, portionLabel } = parseUnitKey(input.unitKey);
  return toGrams(food, { amount: toNumber(input.amount), unit, portionLabel });
}

export function builderToDraft(state: BuilderState, recipeId?: string | null): RecipeDraft {
  return {
    recipeId: recipeId ?? null,
    name: state.name,
    instructions: state.instructions,
    servings: toNumber(state.servings),
    blocks: state.blocks.map((block) => ({
      name: block.name,
      operation: block.operation || null,
      outputGrams: block.outputGrams.trim() ? toNumber(block.outputGrams) : null,
      inputs: block.inputs
        .filter((input) => input.foodId)
        .map((input) => {
          const { unit, portionLabel } = parseUnitKey(input.unitKey);
          return {
            foodId: input.foodId,
            amount: toNumber(input.amount),
            unit,
            portionLabel: portionLabel ?? null,
            preparation: input.preparation || null,
            note: input.note || null,
          };
        }),
    })),
  };
}

/**
 * Compute the recipe as the server would, for the review step.
 *
 * Rows that are incomplete are skipped rather than treated as zero, so
 * the preview never invents a number. The server recomputes on save;
 * this exists to make review meaningful before committing.
 */
export interface Preview {
  result: RecipeResult | null;
  /** Rows that could not be used, so the review can say so. */
  incomplete: number;
  /** Why there is no result, when there is none. */
  problem: "servings" | "ingredients" | null;
}

export function previewRecipe(state: BuilderState, foods: Food[]): Preview {
  const byId = new Map(foods.map((food) => [food.id, food]));
  const servings = toNumber(state.servings);
  if (!Number.isFinite(servings) || servings <= 0) {
    return { result: null, incomplete: 0, problem: "servings" };
  }

  let incomplete = 0;
  const blocks: RecipeBlockInput[] = [];

  for (const block of state.blocks) {
    const lines: RecipeBlockInput["inputs"] = [];

    for (const input of block.inputs) {
      const food = byId.get(input.foodId);
      if (!food) {
        if (input.foodId === "" && input.amount.trim() === "") continue;
        incomplete += 1;
        continue;
      }
      const grams = inputGrams(food, input);
      if (!grams.ok || grams.grams <= 0) {
        incomplete += 1;
        continue;
      }
      lines.push({ label: food.name, profile: food.nutrients, grams: grams.grams });
    }

    if (lines.length === 0) continue;

    const output = toNumber(block.outputGrams);
    blocks.push({
      name: block.name,
      operation: block.operation || null,
      inputs: lines,
      outputGrams: block.outputGrams.trim() && Number.isFinite(output) && output > 0 ? output : null,
    });
  }

  if (blocks.length === 0) return { result: null, incomplete, problem: "ingredients" };

  return { result: computeRecipe(blocks, servings), incomplete, problem: null };
}
