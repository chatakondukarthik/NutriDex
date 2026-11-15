"use server";

import { revalidatePath } from "next/cache";
import { addEntry, removeEntry, today } from "@/lib/db/entries";
import {
  addPlanEntry,
  listPlanEntries,
  getOrCreatePlan,
  movePlanEntry,
  removePlanEntry,
  updatePlanEntryQuantity,
} from "@/lib/db/plan";
import { saveProfile } from "@/lib/db/profile";
import { getRecipe, getVersion } from "@/lib/db/recipes";
import { getFood } from "@/lib/db/foods";
import { toGrams, MAX_GRAMS, type Unit } from "@/lib/nutrition/units";
import { SLOTS, weekDays, weekStart, type PlanEntry, type Slot } from "@/lib/plan";
import { parseProfile } from "@/lib/profile";
import { saveRecipeDraft, type RecipeDraft } from "@/lib/recipes";
import { builderFromVersion } from "@/lib/recipe-draft";
import { builderToDraft } from "@/lib/recipe-draft";
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
    targetEnergyKcal: formData.get("targetEnergyKcal"),
  });

  if (!parsed.ok) return { ok: false, message: parsed.message };

  saveProfile(parsed.profile);
  revalidatePath("/");
  revalidatePath("/plan");
  revalidatePath("/");
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
  fallbackBaseUrl?: string;
  imageProvider?: string;
  imageModel?: string;
  imageBaseUrl?: string;
  imageFallbackProvider?: string;
  imageFallbackModel?: string;
  imageFallbackBaseUrl?: string;
  dailyCallCap?: number;
  key?: string;
}): Promise<AiConfigResult> {
  const config = {
    enabled: input.enabled !== false,
    provider: input.provider as any,
    model: input.model.trim(),
    baseUrl: input.baseUrl?.trim() || undefined,
    fallbackProvider: (input.fallbackProvider || undefined) as any,
    fallbackModel: input.fallbackModel?.trim() || undefined,
    fallbackBaseUrl: input.fallbackBaseUrl?.trim() || undefined,
    imageProvider: (input.imageProvider || undefined) as any,
    imageModel: input.imageModel?.trim() || undefined,
    imageBaseUrl: input.imageBaseUrl?.trim() || undefined,
    imageFallbackProvider: (input.imageFallbackProvider || undefined) as any,
    imageFallbackModel: input.imageFallbackModel?.trim() || undefined,
    imageFallbackBaseUrl: input.imageFallbackBaseUrl?.trim() || undefined,
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

export async function setAiKeyAction(provider: string, key: string): Promise<AiConfigResult> {
  setKey(provider, key);
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

export async function testProviderAction(input: {
  provider: string;
  model: string;
  baseUrl?: string;
}): Promise<AiConfigResult & { latencyMs?: number }> {
  const secrets = await import("@/lib/ai/secrets");
  const adapters = await import("@/lib/ai/adapters");
  if (!secrets.hasKey(input.provider)) {
    return { ok: false, message: "No key configured for that provider." };
  }
  const config = {
    provider: input.provider as any,
    model: input.model,
    baseUrl: input.baseUrl,
  } as any;
  const adapter = adapters.getAdapter(input.provider);
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

export async function duplicateRecipeAction(recipeId: string): Promise<{ ok: boolean; recipeId?: string; message?: string }> {
  const recipe = getRecipe(recipeId);
  if (!recipe) return { ok: false, message: "That recipe no longer exists." };
  const version = getVersion(recipe.summary.currentVersionId!);
  if (!version) return { ok: false, message: "That recipe has no version to copy." };
  const builder = builderFromVersion(version);
  builder.name = `Copy of ${recipe.summary.name}`;
  const draft = builderToDraft(builder, null);
  const result = saveRecipeDraft(draft);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/recipes");
  return { ok: true, recipeId: result.recipeId };
}

export async function copyPlanDayAction(
  sourceDay: string,
  targetDay: string,
): Promise<{ ok: boolean; message?: string; count?: number }> {
  const { weekStart, weekDays } = await import("@/lib/plan");
  const sourceWeek = weekStart(sourceDay);
  const targetWeek = weekStart(targetDay);
  if (!weekDays(sourceWeek).includes(sourceDay)) return { ok: false, message: "Invalid source day." };
  if (!weekDays(targetWeek).includes(targetDay)) return { ok: false, message: "Invalid target day." };

  const sourcePlan = getOrCreatePlan(sourceWeek);
  const targetPlan = getOrCreatePlan(targetWeek);
  const entries = listPlanEntries(sourcePlan.id).filter((e) => e.day === sourceDay);

  let count = 0;
  for (const entry of entries) {
    if (entry.foodId) {
      addPlanEntry({
        planId: targetPlan.id,
        day: targetDay,
        slot: entry.slot,
        foodId: entry.foodId,
        grams: entry.grams ?? 0,
        amount: entry.amount ?? undefined,
        unit: entry.unit ?? undefined,
      });
    } else if (entry.recipeVersionId) {
      addPlanEntry({
        planId: targetPlan.id,
        day: targetDay,
        slot: entry.slot,
        recipeVersionId: entry.recipeVersionId,
        servings: entry.servings ?? 1,
      });
    }
    count++;
  }

  revalidatePath("/plan");
  revalidatePath("/");
  return { ok: true, count };
}

export async function copyPlanWeekAction(
  sourceWeekStart: string,
  targetWeekStart: string,
): Promise<{ ok: boolean; message?: string; count?: number }> {
  const { weekDays } = await import("@/lib/plan");
  const sourceDays = weekDays(sourceWeekStart);
  const targetDays = weekDays(targetWeekStart);
  if (sourceDays.length !== 7 || targetDays.length !== 7) {
    return { ok: false, message: "Invalid week." };
  }

  const sourcePlan = getOrCreatePlan(sourceWeekStart);
  const targetPlan = getOrCreatePlan(targetWeekStart);
  const sourceEntries = listPlanEntries(sourcePlan.id);

  let count = 0;
  for (const entry of sourceEntries) {
    const dayIndex = sourceDays.indexOf(entry.day);
    if (dayIndex < 0) continue;
    const targetDay = targetDays[dayIndex];
    if (entry.foodId) {
      addPlanEntry({
        planId: targetPlan.id,
        day: targetDay,
        slot: entry.slot,
        foodId: entry.foodId,
        grams: entry.grams ?? 0,
        amount: entry.amount ?? undefined,
        unit: entry.unit ?? undefined,
      });
    } else if (entry.recipeVersionId) {
      addPlanEntry({
        planId: targetPlan.id,
        day: targetDay,
        slot: entry.slot,
        recipeVersionId: entry.recipeVersionId,
        servings: entry.servings ?? 1,
      });
    }
    count++;
  }

  revalidatePath("/plan");
  revalidatePath("/");
  return { ok: true, count };
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

import { lookupBarcode, offToInput } from "@/lib/food-sources/openfoodfacts";

export async function lookupBarcodeAction(barcode: string): Promise<{
  ok: boolean;
  proposal?: any;
  message?: string;
}> {
  try {
    const product = await lookupBarcode(barcode);
    if (!product) return { ok: false, message: "Not found in Open Food Facts. Try a different barcode or add it manually." };
    return { ok: true, proposal: offToInput(product) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Lookup failed." };
  }
}

import { searchUsda, usdaToInput } from "@/lib/food-sources/usda";

export async function searchUsdaAction(query: string): Promise<{
  ok: boolean;
  results?: { fdcId: number; name: string; category?: string; nutrients: number }[];
  message?: string;
}> {
  try {
    const foods = await searchUsda(query);
    return {
      ok: true,
      results: foods.map((f) => ({
        fdcId: f.fdcId,
        name: f.name,
        category: f.category,
        nutrients: Object.keys(f.nutrients).length,
      })),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Search failed." };
  }
}

export async function importUsdaAction(fdcId: number): Promise<{ ok: boolean; proposal?: any; message?: string }> {
  try {
    const { getUsdaFood, usdaToInput } = await import("@/lib/food-sources/usda");
    const food = await getUsdaFood(fdcId);
    if (!food) return { ok: false, message: "That food could not be loaded." };
    return { ok: true, proposal: usdaToInput(food) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Import failed." };
  }
}


export async function importInndbAction(
  csvText: string,
  mappingJson?: string,
): Promise<{ ok: boolean; imported?: number; skipped?: number; errors?: { row: number; name: string; message: string }[]; message?: string }> {
  try {
    const { importInndb, DEFAULT_INNDB_MAPPING } = await import("@/lib/importer/inndb");
    const mapping = mappingJson ? JSON.parse(mappingJson) : DEFAULT_INNDB_MAPPING;
    const result = importInndb(csvText, mapping);
    revalidatePath("/foods");
    return { ok: true, imported: result.imported, skipped: result.skipped, errors: result.errors };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Import failed." };
  }
}

import { deleteRecipe } from "@/lib/db/recipes";
import { deleteCapturedFood } from "@/lib/db/foods";

export async function deleteRecipeAction(recipeId: string): Promise<{ ok: boolean; outcome?: string; message?: string }> {
  const { getRecipe } = await import("@/lib/db/recipes");
  if (!getRecipe(recipeId)) return { ok: false, message: "That recipe no longer exists." };
  const result = deleteRecipe(recipeId);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/recipes");
  revalidatePath(`/recipes/${recipeId}`);
  return { ok: true, outcome: result.outcome };
}

export async function deleteCapturedFoodAction(foodId: string): Promise<{ ok: boolean; outcome?: string; message?: string }> {
  const { getFood } = await import("@/lib/db/foods");
  if (!getFood(foodId)) return { ok: false, message: "That food no longer exists." };
  const result = deleteCapturedFood(foodId);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/foods");
  return { ok: true, outcome: result.outcome };
}

import { saveGraphDraft } from "@/lib/recipes-v2";
import type { Graph } from "@/lib/nutrition/graph";

export async function saveGraphAction(input: {
  recipeId?: string | null;
  name: string;
  versionLabel?: string | null;
  instructions: string;
  servings: number | string;
  layout?: Record<string, { x: number; y: number }>;
  graph: Graph;
  mode?: "new-version" | "replace-current";
  replaceVersionId?: string | null;
}): Promise<{ ok: boolean; recipeId?: string; message?: string }> {
  const result = saveGraphDraft({
    recipeId: input.recipeId ?? null,
    name: input.name,
    versionLabel: input.versionLabel ?? null,
    instructions: input.instructions,
    servings: input.servings,
    layout: input.layout,
    graph: input.graph,
    mode: input.mode,
    replaceVersionId: input.replaceVersionId ?? null,
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/recipes");
  revalidatePath(`/recipes/${result.recipeId}`);
  return { ok: true, recipeId: result.recipeId };
}

import { estimateNodeDeltas, type NodeEstimate } from "@/lib/ai/estimate";

export async function estimateNodeDeltasAction(input: {
  operation: string;
  qualifier?: string | null;
  inputs: { name: string; grams: number; kcalPer100g: number | null }[];
  note?: string;
}): Promise<{ ok: boolean; estimate?: NodeEstimate; message?: string }> {
  const { isAiEnabled, getAiConfig } = await import("@/lib/ai/client");
  if (!isAiEnabled()) return { ok: false, message: "AI is turned off in Settings." };
  try {
    const config = getAiConfig();
    if (!(await import("@/lib/ai/secrets")).hasKey(config.provider)) {
      return { ok: false, message: "No key configured. Add one in Settings." };
    }
    const estimate = await estimateNodeDeltas(input);
    return { ok: true, estimate };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Estimation failed." };
  }
}

import { convertAllLegacyRecipes } from "@/lib/legacy-convert";

export async function convertAllRecipesToV2Action(): Promise<{ ok: boolean; converted?: number; skipped?: number; errors?: { name: string; message: string }[]; message?: string }> {
  try {
    const result = convertAllLegacyRecipes();
    revalidatePath("/recipes");
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Conversion failed." };
  }
}

import { planRecipeFromPrompt, materializeRecipe, type RecipePlan } from "@/lib/ai-generate-recipe";
import { resolvePlanFoods, type PlanFoodResolution } from "@/lib/ai/food-resolve";

export async function previewRecipeFromPromptAction(
  input: { prompt: string; recipeId?: string | null },
): Promise<{ ok: boolean; plan?: RecipePlan; resolutions?: PlanFoodResolution[]; message?: string }> {
  try {
    let existing;
    if (input.recipeId) {
      const { getVersion } = await import("@/lib/db/recipes");
      const { getRecipe } = await import("@/lib/db/recipes");
      const recipe = getRecipe(input.recipeId);
      const version = recipe?.summary.currentVersionId ? getVersion(recipe.summary.currentVersionId) : undefined;
      if (version) {
        const snap = version.snapshot as unknown as { graph?: unknown };
        existing = {
          name: version.recipeName,
          servings: version.servings,
          instructions: version.instructions,
          graph: snap.graph ?? null,
        };
      }
    }
    const plan = await planRecipeFromPrompt(input.prompt, existing);
    const { listFoods } = await import("@/lib/db/foods");
    const { resolutions } = await resolvePlanFoods(plan, listFoods(), { persist: false });
    return { ok: true, plan, resolutions };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not plan that recipe.",
    };
  }
}

export async function createRecipeFromPlanAction(
  input: RecipePlan & {
    recipeId?: string | null;
    mode?: "new-version" | "replace-current";
    replaceVersionId?: string | null;
    /** Fill missing ingredient nutrition with AI before saving (default: true). */
    fillMissingNutrition?: boolean;
  },
): Promise<{ ok: boolean; recipeId?: string; message?: string }> {
  try {
    const base = input as RecipePlan;
    const saved = await materializeRecipe(base, input.recipeId ?? undefined, {
      mode: input.mode,
      replaceVersionId: input.replaceVersionId ?? null,
      fillMissingNutrition: input.fillMissingNutrition,
    });
    const { recipeId } = saved;
    revalidatePath("/recipes");
    if (input.recipeId) revalidatePath(`/recipes/${input.recipeId}`);
    return { ok: true, recipeId };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not create the recipe.",
    };
  }
}

import { addRecipeEntry as addRecipeDiaryEntry } from "@/lib/db/entries";
import { listRecipeOptions } from "@/lib/db/recipes";

export async function addRecipeEntryAction(input: {
  recipeVersionId: string;
  servings: number;
}): Promise<AddResult> {
  const version = getVersion(input.recipeVersionId);
  if (!version) return { ok: false, message: "That recipe version no longer exists." };

  const servings = Number(input.servings);
  if (!Number.isFinite(servings) || servings <= 0) {
    return { ok: false, message: "Servings must be a positive number." };
  }

  // Grams are a convenience for display (per-serving input mass).
  const snapshot = version.snapshot as unknown as { inputGrams?: number };
  const perServing = input.servings === 0 ? 1 : snapshot.inputGrams ? snapshot.inputGrams / version.servings : 0;
  const totalGrams = perServing * servings;

  addRecipeDiaryEntry({
    recipeVersionId: input.recipeVersionId,
    servings,
    grams: totalGrams,
    amount: servings,
    unit: "serving",
    day: today(),
  });

  revalidatePath("/");
  return { ok: true };
}

import { deleteVersion, getVersion as getVersionForDelete } from "@/lib/db/recipes";

export async function deleteRecipeVersionAction(input: {
  recipeId: string;
  versionId: string;
}): Promise<{ ok: boolean; message?: string }> {
  const version = getVersionForDelete(input.versionId);
  if (!version) return { ok: false, message: "That version no longer exists." };
  if (version.recipeId !== input.recipeId) {
    return { ok: false, message: "That version does not belong to this recipe." };
  }
  const result = deleteVersion(input.versionId);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/recipes");
  revalidatePath(`/recipes/${input.recipeId}`);
  return { ok: true };
}

import { promoteVersion } from "@/lib/db/recipes";

export async function makeCurrentRecipeVersionAction(input: {
  recipeId: string;
  versionId: string;
}): Promise<{ ok: boolean; message?: string }> {
  const result = promoteVersion(input.recipeId, input.versionId);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/recipes");
  revalidatePath(`/recipes/${input.recipeId}`);
  revalidatePath("/plan");
  revalidatePath("/");
  return { ok: true };
}

import { fillEstimatedCapturedFood } from "@/lib/db/foods";
import { listFoods } from "@/lib/db/foods";
import { getMasterPrompt, setMasterPrompt, resetMasterPrompt } from "@/lib/db/settings";
import { DEFAULT_MASTER_PROMPT } from "@/lib/ai/master-prompt";
import { estimateNutrients } from "@/lib/ai/estimate-food";

export async function estimateFoodNutrientsAction(
  foodId: string,
): Promise<{ ok: boolean; filled?: number; missing?: number; total?: number; message?: string }> {
  const { isAiEnabled, getAiConfig } = await import("@/lib/ai/client");
  if (!isAiEnabled()) {
    return { ok: false, message: "AI is turned off in Settings." };
  }
  const { hasKey } = await import("@/lib/ai/secrets");
  const config = getAiConfig();
  if (!hasKey(config.provider)) {
    return { ok: false, message: "No AI key configured. Add one in Settings." };
  }

  const food = getFood(foodId);
  if (!food) return { ok: false, message: "That food no longer exists." };
  if (!food.source) {
    return { ok: false, message: "Seed fixtures are not editable — capture your own copy first." };
  }

  // Refresh captured state from the DB so concurrent edits don't re-estimate.
  const fresh = listFoods().find((candidate) => candidate.id === foodId);
  const target = fresh ?? food;

  try {
    const estimate = await estimateNutrients(target, { masterPrompt: getMasterPrompt() });
    if (estimate.fills.length === 0) {
      return {
        ok: true,
        filled: 0,
        missing: 0,
        total: 0,
        message: "Every nutrient is filled in, or the model had nothing confident to add.",
      };
    }
    const result = fillEstimatedCapturedFood(foodId, estimate.fills.map((fill) => ({
      code: fill.code,
      amount: fill.amount,
      confidence: fill.confidence,
      reason: fill.reason,
      model: estimate.model,
    })));
    revalidatePath(`/foods/${foodId}`);
    revalidatePath("/foods");
    return {
      ok: true,
      filled: result.filled,
      total: estimate.fills.length,
      message:
        estimate.fills.length === result.filled
          ? `Filled ${result.filled} unknown nutrient${result.filled === 1 ? "" : "s"} with AI estimates.`
          : `Filled ${result.filled} of ${estimate.fills.length} — the rest were already filled.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The estimate failed.",
    };
  }
}

export async function saveMasterPromptAction(
  value: string,
): Promise<{ ok: boolean; message?: string }> {
  const trimmed = value.trim();
  if (trimmed.length > 2000) {
    return { ok: false, message: "Keep it under 2,000 characters." };
  }
  setMasterPrompt(trimmed ? trimmed : DEFAULT_MASTER_PROMPT);
  revalidatePath("/settings");
  return { ok: true };
}

export async function resetMasterPromptAction(): Promise<{ ok: boolean }> {
  resetMasterPrompt();
  revalidatePath("/settings");
  return { ok: true };
}

export async function estimateFoodsAction(input?: {
  foodIds?: string[];
}): Promise<{
  ok: boolean;
  filled?: number;
  skipped?: number;
  failed?: string[];
  message?: string;
}> {
  const { isAiEnabled, getAiConfig } = await import("@/lib/ai/client");
  if (!isAiEnabled()) return { ok: false, message: "AI is turned off in Settings." };
  const { hasKey } = await import("@/lib/ai/secrets");
  const config = getAiConfig();
  if (!hasKey(config.provider)) {
    return { ok: false, message: "No AI key configured. Add one in Settings." };
  }

  const { fillAllWithAi } = await import("@/lib/ai/estimate-food");
  try {
    const result = await fillAllWithAi({ masterPrompt: getMasterPrompt(), foodIds: input?.foodIds });
    const failedNames = result.failed.length;
    revalidatePath("/foods");
    revalidatePath("/");
    return {
      ok: true,
      filled: result.foodsEstimated,
      skipped: result.skipped,
      failed: result.failed.map((f) => f.name),
      message:
        failedNames === 0
          ? `Estimated ${result.nutritionEntries} values across ${result.foodsEstimated} food${result.foodsEstimated === 1 ? "" : "s"}.`
          : `Estimated ${result.nutritionEntries} values; ${failedNames} food${failedNames === 1 ? "" : "s"} failed: ${result.failed.map((f) => f.name).join(", ")}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The batch estimate failed.",
    };
  }
}
