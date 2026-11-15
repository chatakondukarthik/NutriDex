"use server";

import { revalidatePath } from "next/cache";
import { addEntry, removeEntry, today } from "@/lib/db/entries";
import {
  addPlanEntry,
  getOrCreatePlan,
  movePlanEntry,
  removePlanEntry,
  updatePlanEntryQuantity,
} from "@/lib/db/plan";
import { saveProfile } from "@/lib/db/profile";
import { getVersion } from "@/lib/db/recipes";
import { getFood } from "@/lib/db/foods";
import { toGrams, MAX_GRAMS, type Unit } from "@/lib/nutrition/units";
import { SLOTS, weekDays, weekStart, type PlanEntry, type Slot } from "@/lib/plan";
import { parseProfile } from "@/lib/profile";
import { saveRecipeDraft, type RecipeDraft } from "@/lib/recipes";
import type { CapturedFoodInput } from "@/lib/captured-food";

export interface AddResult {
  ok: boolean;
  message?: string;
}

const VALID_UNITS: Unit[] = ["g", "kg", "ml", "l", "portion"];

/**
 * Add a food to today's list.
 *
 * Treat every server action as an untrusted entry point: validate the
 * unit, the amount and the food id here, and never trust the client to
 * have done it. The gram conversion lives on the server for the same
 * reason — there is exactly one place a weight can be produced.
 */
export async function addFoodAction(input: {
  foodId: string;
  amount: number;
  unit: string;
  portionLabel?: string;
}): Promise<AddResult> {
  const food = getFood(input.foodId);
  if (!food) {
    return { ok: false, message: "That food does not exist." };
  }

  if (!VALID_UNITS.includes(input.unit as Unit)) {
    return { ok: false, message: "Unsupported unit." };
  }

  const unit = input.unit as Unit;
  const converted = toGrams(food, {
    amount: input.amount,
    unit,
    portionLabel: input.portionLabel,
  });

  if (!converted.ok) {
    return { ok: false, message: converted.reason };
  }

  addEntry({
    foodId: food.id,
    grams: converted.grams,
    amount: input.amount,
    unit: input.unit,
    day: today(),
  });

  revalidatePath("/");
  return { ok: true };
}

export async function removeEntryAction(id: string): Promise<void> {
  removeEntry(id);
  revalidatePath("/");
}

export interface SaveRecipeResult {
  ok: boolean;
  message?: string;
  recipeId?: string;
  versionId?: string;
  versionNo?: number;
}

/**
 * Save a recipe draft.
 *
 * Every save produces a new immutable version (D-018, D-024). The
 * nutrition snapshot is computed here, on the server, from the stored
 * gram weights — never trusted from the client.
 */
export async function saveRecipeAction(draft: RecipeDraft): Promise<SaveRecipeResult> {
  try {
    const result = saveRecipeDraft(draft);
    if (!result.ok) return result;

    revalidatePath("/recipes");
    revalidatePath(`/recipes/${result.recipeId}`);

    return {
      ok: true,
      recipeId: result.recipeId,
      versionId: result.versionId,
      versionNo: result.versionNo,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not save the recipe.",
    };
  }
}

/* ---------------------------------------------------------------- plan */

export interface PlanActionResult {
  ok: boolean;
  message?: string;
  entry?: PlanEntry;
}

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Add a food or a pinned recipe version to a day of the plan.
 *
 * The week arrives from the client as a start date; the plan row is looked
 * up (or created) here, so a caller cannot write into someone else's week.
 * The day is checked against the week, and the quantity is checked against
 * what the entry actually points at — a food needs grams, a recipe needs
 * servings. Everything else about the item is read from the database, never
 * from the request.
 */
export async function addPlanEntryAction(input: {
  week: string;
  day: string;
  slot: string;
  foodId?: string | null;
  recipeVersionId?: string | null;
  grams?: number | null;
  servings?: number | null;
}): Promise<PlanActionResult> {
  if (!isDay(input.week)) return { ok: false, message: "That week is not valid." };

  const start = weekStart(input.week);
  if (!isDay(input.day) || !weekDays(start).includes(input.day)) {
    return { ok: false, message: "That day is not in this week." };
  }

  if (!SLOTS.includes(input.slot as Slot)) {
    return { ok: false, message: "Unknown meal slot." };
  }

  const hasFood = input.foodId != null;
  const hasRecipe = input.recipeVersionId != null;
  if (hasFood === hasRecipe) {
    return { ok: false, message: "Choose a food or a recipe." };
  }

  // Validate everything before touching the database: a rejected request
  // must not leave an empty plan row behind.
  let foodId: string | null = null;
  let versionId: string | null = null;
  let grams: number | null = null;
  let servings: number | null = null;

  if (hasFood) {
    const food = getFood(input.foodId as string);
    if (!food) return { ok: false, message: "That food does not exist." };
    foodId = food.id;

    grams = Number(input.grams);
    if (!Number.isFinite(grams) || grams <= 0) {
      return { ok: false, message: "Weight must be a positive number." };
    }
    if (grams > MAX_GRAMS) {
      return { ok: false, message: "That weight is too large — check the amount." };
    }
  } else {
    const version = getVersion(input.recipeVersionId as string);
    if (!version) return { ok: false, message: "That recipe version does not exist." };
    versionId = version.id;

    servings = Number(input.servings);
    if (!Number.isFinite(servings) || servings <= 0) {
      return { ok: false, message: "Servings must be a positive number." };
    }
  }

  try {
    const plan = getOrCreatePlan(start);
    const entry = addPlanEntry({
      planId: plan.id,
      day: input.day,
      slot: input.slot as Slot,
      foodId,
      recipeVersionId: versionId,
      grams,
      servings,
    });
    return { ok: true, entry };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not add that item.",
    };
  }
}

/** Change only the quantity; what the entry points at never moves. */
export async function updatePlanEntryQuantityAction(
  id: string,
  patch: { grams: number } | { servings: number },
): Promise<PlanActionResult> {
  try {
    if ("grams" in patch) {
      const grams = Number(patch.grams);
      if (!Number.isFinite(grams) || grams <= 0) {
        return { ok: false, message: "Weight must be a positive number." };
      }
      if (grams > MAX_GRAMS) {
        return { ok: false, message: "That weight is too large — check the amount." };
      }
      updatePlanEntryQuantity(id, { grams });
    } else {
      const servings = Number(patch.servings);
      if (!Number.isFinite(servings) || servings <= 0) {
        return { ok: false, message: "Servings must be a positive number." };
      }
      updatePlanEntryQuantity(id, { servings });
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not update that item.",
    };
  }
}

export async function removePlanEntryAction(id: string): Promise<void> {
  removePlanEntry(id);
}

/**
 * Move a planned item to another day or slot.
 *
 * The week and the day are checked exactly as they are on add: the client
 * cannot move an entry into a day that is not part of the week it claims.
 * What the entry points at and its quantity are untouched.
 */
export async function movePlanEntryAction(input: {
  week: string;
  id: string;
  day: string;
  slot: string;
}): Promise<PlanActionResult> {
  if (!isDay(input.week)) return { ok: false, message: "That week is not valid." };

  const start = weekStart(input.week);
  if (!isDay(input.day) || !weekDays(start).includes(input.day)) {
    return { ok: false, message: "That day is not in this week." };
  }

  if (!SLOTS.includes(input.slot as Slot)) {
    return { ok: false, message: "Unknown meal slot." };
  }

  try {
    const entry = movePlanEntry(input.id, {
      day: input.day,
      slot: input.slot as Slot,
    });
    return { ok: true, entry };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not move that item.",
    };
  }
}

/* ------------------------------------------------------------- profile */

export interface ProfileFormState {
  ok: boolean;
  message?: string;
}

/**
 * Save the one local profile.
 *
 * The form is the only place these numbers enter the system, so it is the
 * only place they are validated. Targets are derived, never stored: change
 * the profile and every screen recalculates from it.
 */
export async function saveProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const parsed = parseProfile({
    sex: formData.get("sex"),
    ageYears: formData.get("ageYears"),
    heightCm: formData.get("heightCm"),
    weightKg: formData.get("weightKg"),
    activity: formData.get("activity"),
    goal: formData.get("goal"),
    bodyFatPercent: formData.get("bodyFatPercent"),
    pace: formData.get("pace"),
    targetWeightKg: formData.get("targetWeightKg"),
  });

  if (!parsed.ok) return { ok: false, message: parsed.message };

  saveProfile(parsed.profile);
  revalidatePath("/");
  revalidatePath("/plan");
  revalidatePath("/profile");

  return { ok: true, message: "Saved. Targets now use these numbers." };
}

// ---------- Captured foods ----------

import { prepareCapturedFood } from "@/lib/captured-food";
import { saveCapturedFood, updateCapturedFood, archiveCapturedFood } from "@/lib/db/foods";
import { extractFoodFromText, extractFoodFromImage, proposalToInput } from "@/lib/ai/extract";
import type { ImagePart } from "@/lib/ai/types";
import { getAiConfig, aiStatus } from "@/lib/ai/client";
import { readAiConfig, writeAiConfig } from "@/lib/ai/config";
import { getKey, setKey, hasKey } from "@/lib/ai/secrets";
import { getAdapter } from "@/lib/ai/adapters";

export interface SaveFoodResult {
  ok: boolean;
  message?: string;
  foodId?: string;
  duplicateOf?: string;
}

export async function saveCapturedFoodAction(input: CapturedFoodInput): Promise<SaveFoodResult> {
  const prepared = prepareCapturedFood(input);
  if (!prepared.ok) return { ok: false, message: prepared.message };
  const result = saveCapturedFood(prepared.food);
  if (!result.ok) return { ok: false, message: result.message, duplicateOf: result.duplicateOf };
  revalidatePath("/");
  revalidatePath("/foods");
  return { ok: true, foodId: result.food.id };
}

export async function updateCapturedFoodAction(
  id: string,
  input: CapturedFoodInput,
): Promise<SaveFoodResult> {
  const prepared = prepareCapturedFood(input);
  if (!prepared.ok) return { ok: false, message: prepared.message };
  const result = updateCapturedFood(id, prepared.food);
  if (!result.ok) return { ok: false, message: result.message, duplicateOf: result.duplicateOf };
  revalidatePath("/");
  revalidatePath("/foods");
  return { ok: true, foodId: result.food.id };
}

export async function archiveCapturedFoodAction(id: string): Promise<SaveFoodResult> {
  const result = archiveCapturedFood(id);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/foods");
  return { ok: true };
}

export interface AiConfigResult {
  ok: boolean;
  message?: string;
}

export async function saveAiConfigAction(input: {
  enabled?: boolean;
  provider: string;
  model: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  baseUrl?: string;
  dailyCallCap?: number;
  key?: string;
}): Promise<AiConfigResult> {
  const config = {
    enabled: input.enabled !== false,
    provider: input.provider as any,
    model: input.model.trim(),
    fallbackProvider: input.fallbackProvider as any,
    fallbackModel: input.fallbackModel?.trim() || undefined,
    baseUrl: input.baseUrl?.trim() || undefined,
    dailyCallCap: input.dailyCallCap,
  };
  if (!config.model) return { ok: false, message: "Pick a model." };
  if (input.key && input.key.trim()) {
    setKey(input.provider, input.key);
  }
  writeAiConfig(config as any);
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeAiKeyAction(provider: string): Promise<AiConfigResult> {
  setKey(provider, null);
  revalidatePath("/settings");
  return { ok: true };
}

export async function testAiConnectionAction(): Promise<AiConfigResult & { latencyMs?: number }> {
  const config = getAiConfig();
  if (!hasKey(config.provider)) return { ok: false, message: "No key configured." };
  const adapter = getAdapter(config.provider);
  const start = Date.now();
  try {
    await adapter.complete(config, {
      capability: "text",
      system: "Reply with the single word: ok",
      prompt: "ping",
      temperature: 0,
      maxTokens: 8,
      timeoutMs: 20_000,
    });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Connection failed." };
  }
}

export async function listAiModelsAction(): Promise<{ ok: boolean; models?: { id: string; label: string }[]; message?: string }> {
  const config = getAiConfig();
  if (!hasKey(config.provider)) return { ok: false, message: "No key configured." };
  const adapter = getAdapter(config.provider);
  try {
    const models = await adapter.listModels({ ...config, baseUrl: config.baseUrl });
    return { ok: true, models: models.map((m) => ({ id: m.id, label: m.label })) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not list models." };
  }
}

export async function extractFoodAction(input: {
  mode: "text" | "image";
  text?: string;
  images?: ImagePart[];
  note?: string;
}): Promise<{ ok: boolean; proposal?: any; message?: string }> {
  const { isAiEnabled } = await import("@/lib/ai/client");
  if (!isAiEnabled()) {
    return { ok: false, message: "AI is turned off in Settings." };
  }
  try {
    const proposal =
      input.mode === "image"
        ? await extractFoodFromImage(input.images ?? [], input.note)
        : await extractFoodFromText(input.text ?? "");
    return { ok: true, proposal };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Extraction failed." };
  }
}

export async function promoteFoodToRecipeAction(foodId: string): Promise<{ ok: boolean; recipeId?: string; message?: string }> {
  const food = getFood(foodId);
  if (!food) return { ok: false, message: "That food does not exist." };
  const draft: RecipeDraft = {
    name: food.name,
    instructions: "",
    servings: 1,
    blocks: [
      {
        name: "Main",
        operation: null,
        outputGrams: 100,
        inputs: [
          {
            foodId: food.id,
            amount: 100,
            unit: "g",
            preparation: "",
            note: "",
          },
        ],
      },
    ],
  };
  const result = saveRecipeDraft(draft);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, recipeId: result.recipeId };
}
