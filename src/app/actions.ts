"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { addEntry, removeEntry, today } from "@/lib/db/entries";
import { transaction } from "@/lib/db/client";
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
import { resolveDefaultAmount, getFoodDefaultPin, setFoodDefaultPin } from "@/lib/db/defaults";
import { toGrams, parseUnitKey, MAX_GRAMS, UNITS, type Unit } from "@/lib/nutrition/units";
import { SLOTS, weekDays, weekStart, type PlanEntry, type Slot } from "@/lib/plan";
import { parseProfile } from "@/lib/profile";
import { saveRecipeDraft, type RecipeDraft } from "@/lib/recipes";
import { builderFromVersion } from "@/lib/recipe-draft";
import { builderToDraft } from "@/lib/recipe-draft";
import type { CapturedFoodInput } from "@/lib/captured-food";
import { publicError } from "@/lib/security/errors";

export interface AddResult {
  ok: boolean;
  message?: string;
}

const VALID_UNITS: Unit[] = ["g", "kg", "ml", "l", "portion"];

/**
 * Every catch in this file returns a fixed sentence, never `error.message`:
 * raw messages carry file paths, SQL and — in the AI layer — provider
 * response bodies. The detail is logged server-side instead.
 */
function fail(fallback: string, error: unknown, context: string): { ok: false; message: string } {
  return { ok: false, message: publicError(fallback, error, context) };
}

/** Servings are counts, not weights — bound them like the plan path bounds grams. */
const MAX_SERVINGS = 1000;

/**
 * The host a key is bound to.
 *
 * Only a caller-supplied `baseUrl` needs this: fixed provider endpoints use
 * `getKey`. Returning `null` leaves the key unbound, which is correct for a
 * fixed endpoint and fail-closed for a custom one (the key will not be sent).
 */
function hostFromUrl(raw: string | undefined | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * In-process throttle for actions that spend upstream quota or hold a socket.
 *
 * The daily AI cap is the primary cost brake; this stops a rapid loop from
 * draining it in one second. Separate buckets per action so a burst of
 * planning does not lock the user out of a connection test.
 */
async function aiThrottle(bucket: string, limit = 20, windowMs = 60_000): Promise<string | null> {
  const { rateLimit } = await import("@/lib/security/rate-limit");
  const budget = rateLimit(`ai:${bucket}`, limit, windowMs);
  return budget.ok ? null : `Too many requests — try again in ${budget.retryAfter}s.`;
}

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
      message: publicError("Could not save the recipe.", error),
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
  /** Amount + unit travel together; omit both to use the default chain. */
  amount?: number | null;
  unit?: string | null;
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
  let amount: number | null = null;
  let unit: string | null = null;
  let servings: number | null = null;

  if (hasFood) {
    if (typeof input.foodId !== "string") {
      return { ok: false, message: "That food does not exist." };
    }
    const food = getFood(input.foodId);
    if (!food) return { ok: false, message: "That food does not exist." };
    foodId = food.id;

    if (input.grams != null) {
      // Explicit grams from the caller: validate, and record the
      // user-facing pair so the row can show "120 g".
      grams = Number(input.grams);
      if (!Number.isFinite(grams) || grams <= 0) {
        return { ok: false, message: "Weight must be a positive number." };
      }
      amount = grams;
      unit = "g";
    } else if (input.amount != null || input.unit != null) {
      // Amount + unit travel together; half of the pair is a client bug.
      if (input.amount == null || input.unit == null) {
        return { ok: false, message: "Amount and unit go together." };
      }
      if (typeof input.unit !== "string") {
        return { ok: false, message: "That amount could not be measured." };
      }
      amount = Number(input.amount);
      unit = input.unit;
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, message: "Amount must be a positive number." };
      }
      const parsed = parseUnitKey(unit);
      const converted = toGrams(food, {
        amount,
        unit: parsed.unit,
        portionLabel: parsed.portionLabel,
      });
      grams = converted.ok ? converted.grams : null;
      if (grams == null) {
        return { ok: false, message: "That amount could not be measured." };
      }
    } else {
      // No quantity from the client: the default chain answers
      // (pin → last-used → portion → serving → rules → 100 g).
      const resolved = resolveDefaultAmount(food.id) ?? { amount: 100, unit: "g" };
      amount = resolved.amount;
      unit = resolved.unit;
      const parsed = parseUnitKey(unit);
      const converted = toGrams(food, {
        amount,
        unit: parsed.unit,
        portionLabel: parsed.portionLabel,
      });
      grams = converted.ok ? converted.grams : 100;
    }

    if (grams == null || !Number.isFinite(grams) || grams <= 0) {
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
    if (!Number.isFinite(servings) || servings <= 0 || servings > MAX_SERVINGS) {
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
      amount,
      unit,
      servings,
    });
    return { ok: true, entry };
  } catch (error) {
    return {
      ok: false,
      message: publicError("Could not add that item.", error),
    };
  }
}

/** Change only the quantity; what the entry points at never moves. */
export async function updatePlanEntryQuantityAction(
  id: string,
  patch:
    | { grams: number; amount?: number | null; unit?: string | null }
    | { servings: number },
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
      if (patch.amount != null && !(Number.isFinite(patch.amount) && patch.amount > 0)) {
        return { ok: false, message: "Amount must be a positive number." };
      }
      // The unit is display metadata, but it is still client input. Accept
      // only a known unit or `portion:<label>`; a 1 MB string here would be
      // stored and re-rendered on every plan read.
      const unit = patch.unit ?? null;
      if (unit != null) {
        // Portion labels are stored up to 80 chars (`captured-food.ts`), so
        // `portion:` + 80 is the real ceiling. 64 rejected labels the UI
        // itself offers.
        if (unit.length > "portion:".length + 80 || !UNITS.some((u) => u.value === parseUnitKey(unit).unit)) {
          return { ok: false, message: "Unsupported unit." };
        }
      }
      updatePlanEntryQuantity(id, { grams, amount: patch.amount ?? null, unit });
    } else {
      const servings = Number(patch.servings);
      if (!Number.isFinite(servings) || servings <= 0 || servings > MAX_SERVINGS) {
        return { ok: false, message: "Servings must be a positive number." };
      }
      updatePlanEntryQuantity(id, { servings });
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: publicError("Could not update that item.", error),
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
      message: publicError("Could not move that item.", error),
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
  try {
    const prepared = prepareCapturedFood(input);
    if (!prepared.ok) return { ok: false, message: prepared.message };
    const result = saveCapturedFood(prepared.food);
    if (!result.ok) return { ok: false, message: result.message, duplicateOf: result.duplicateOf };
    revalidatePath("/");
    revalidatePath("/foods");
    return { ok: true, foodId: result.food.id };
  } catch (error) {
    return { ok: false, message: publicError("Could not save that food.", error, "saveCapturedFoodAction") };
  }
}

export async function updateCapturedFoodAction(
  id: string,
  input: CapturedFoodInput,
): Promise<SaveFoodResult> {
  try {
    if (typeof id !== "string" || !id.trim()) return { ok: false, message: "That food does not exist." };
    const prepared = prepareCapturedFood(input);
    if (!prepared.ok) return { ok: false, message: prepared.message };
    const result = updateCapturedFood(id, prepared.food);
    if (!result.ok) return { ok: false, message: result.message, duplicateOf: result.duplicateOf };
    revalidatePath("/");
    revalidatePath("/foods");
    return { ok: true, foodId: result.food.id };
  } catch (error) {
    return { ok: false, message: publicError("Could not update that food.", error, "updateCapturedFoodAction") };
  }
}

/**
 * The default amount a food pre-fills with when added anywhere:
 * pin → last-used → portion → serving size → name/category rules → 100 g.
 * Client components call this so their optimistic value can be refined
 * with the two stored layers (pin, last-used) they cannot compute.
 */
export async function defaultAmountAction(foodId: string): Promise<{
  ok: boolean;
  amount?: number;
  unit?: string;
  source?: string;
  message?: string;
}> {
  try {
    const resolved = resolveDefaultAmount(foodId);
    if (!resolved) return { ok: false, message: "That food does not exist." };
    return { ok: true, amount: resolved.amount, unit: resolved.unit, source: resolved.source };
  } catch (error) {
    return { ok: false, message: publicError("Could not resolve a default.", error) };
  }
}

/** Read the pinned default for the food editor. */
export async function getFoodDefaultAction(foodId: string): Promise<{
  ok: boolean;
  amount?: number;
  unit?: string;
}> {
  try {
    const pin = getFoodDefaultPin(foodId);
    return pin ? { ok: true, ...pin } : { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Pin the default amount for a food (undefined-ish null clears it).
 * `null` pin clears; validation of usefulness happens at read time in
 * `defaultAmountFor`, but nonsense here is rejected outright.
 */
export async function saveFoodDefaultAction(
  foodId: string,
  pin: { amount: number; unit: string } | null,
): Promise<SaveFoodResult> {
  try {
    if (!getFood(foodId)) return { ok: false, message: "That food does not exist." };
    if (pin !== null) {
      if (!Number.isFinite(pin.amount) || pin.amount <= 0) {
        return { ok: false, message: "Default amount must be a positive number." };
      }
      if (pin.amount > 100_000) {
        return { ok: false, message: "That default amount is too large." };
      }
      // Units are a closed vocabulary — an unknown one used to be stored
      // happily and then silently fail conversion at read time. The pin may
      // hold any unit the converter knows, so check the full set.
      const knownUnits: string[] = UNITS.map((u) => u.value);
      if (!knownUnits.includes(pin.unit)) {
        return { ok: false, message: "Unsupported unit." };
      }
    }
    setFoodDefaultPin(foodId, pin);
    revalidatePath("/foods");
    return { ok: true, foodId };
  } catch (error) {
    return { ok: false, message: publicError("Could not save the default.", error) };
  }
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

/**
 * Persist the AI config.
 *
 * Three things a caller used to control freely: the four `baseUrl` fields
 * (which later receive the stored API key as a Bearer header), the provider
 * ids (which select which key is sent), and `dailyCallCap` (the only cost
 * brake). All three are validated here rather than stored and trusted.
 */
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
  try {
    const limited = await aiThrottle("config", 20);
    if (limited) return { ok: false, message: limited };
    const { ADAPTERS } = await import("@/lib/ai/adapters");
    const { validateOutboundUrl } = await import("@/lib/security/urls");
    const { effectiveDailyCap, clampDailyCap } = await import("@/lib/ai/client");
    const known = Object.keys(ADAPTERS);

    const provider = String(input.provider ?? "").trim();
    if (!known.includes(provider)) return { ok: false, message: "Unknown provider." };
    const fallbackProvider = input.fallbackProvider?.trim();
    if (fallbackProvider && !known.includes(fallbackProvider)) {
      return { ok: false, message: "Unknown fallback provider." };
    }
    const imageProvider = input.imageProvider?.trim();
    if (imageProvider && !known.includes(imageProvider)) {
      return { ok: false, message: "Unknown image provider." };
    }
    const imageFallbackProvider = input.imageFallbackProvider?.trim();
    if (imageFallbackProvider && !known.includes(imageFallbackProvider)) {
      return { ok: false, message: "Unknown image provider." };
    }

    // Reject bad endpoints on save so the mistake surfaces in the form,
    // and re-check in the adapters so a hand-edited config is caught too.
    const baseUrls: Array<[string, string | undefined]> = [
      ["Base URL", input.baseUrl],
      ["Fallback base URL", input.fallbackBaseUrl],
      ["Image base URL", input.imageBaseUrl],
      ["Image fallback base URL", input.imageFallbackBaseUrl],
    ];
    for (const [label, value] of baseUrls) {
      if (!value?.trim()) continue;
      const verdict = await validateOutboundUrl(value.trim());
      if (!verdict.ok) return { ok: false, message: `${label}: ${verdict.reason}` };
    }

    const model = String(input.model ?? "").trim().slice(0, 200);
    if (!model) return { ok: false, message: "Pick a model." };

    const config = {
      enabled: input.enabled !== false,
      provider,
      model,
      baseUrl: input.baseUrl?.trim() || undefined,
      fallbackProvider: (fallbackProvider || undefined) as any,
      fallbackModel: input.fallbackModel?.trim().slice(0, 200) || undefined,
      fallbackBaseUrl: input.fallbackBaseUrl?.trim() || undefined,
      imageProvider: (imageProvider || undefined) as any,
      imageModel: input.imageModel?.trim().slice(0, 200) || undefined,
      imageBaseUrl: input.imageBaseUrl?.trim() || undefined,
      imageFallbackProvider: (imageFallbackProvider || undefined) as any,
      imageFallbackModel: input.imageFallbackModel?.trim().slice(0, 200) || undefined,
      imageFallbackBaseUrl: input.imageFallbackBaseUrl?.trim() || undefined,
      // Absent means "use the default"; an out-of-range number is clamped
      // again at read time, so a stale file cannot disable the brake.
      dailyCallCap:
        input.dailyCallCap === undefined ? undefined : clampDailyCap(input.dailyCallCap),
    };
    if (input.key && input.key.trim()) {
      if (input.key.trim().length > 4_096) {
        return { ok: false, message: "That key is too long." };
      }
      // Bind the key to the endpoint it was entered for. A later change to
      // `baseUrl` then fails closed instead of posting the key to the new
      // host (see `secrets.ts`).
      setKey(provider, input.key.trim(), hostFromUrl(input.baseUrl));
    }
    writeAiConfig(config as any);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return fail("Could not save the AI settings.", error, "saveAiConfigAction");
  }
}

export async function removeAiKeyAction(provider: string): Promise<AiConfigResult> {
  try {
    setKey(provider, null);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return fail("Could not remove the key.", error, "removeAiKeyAction");
  }
}

export async function setAiKeyAction(
  provider: string,
  key: string,
  baseUrl?: string,
): Promise<AiConfigResult> {
  try {
    const limited = await aiThrottle("config", 20);
    if (limited) return { ok: false, message: limited };
    const { ADAPTERS } = await import("@/lib/ai/adapters");
    const known = Object.keys(ADAPTERS);
    const providerId = String(provider ?? "").trim();
    if (!known.includes(providerId)) return { ok: false, message: "Unknown provider." };
    // A key is a credential, not free text: cap it so a 16 MB body cannot be
    // written to `secrets.json` by a direct action call.
    const value = String(key ?? "").trim();
    if (value.length > 4_096) return { ok: false, message: "That key is too long." };
    // The endpoint becomes part of the storage key (`provider@host`) and is
    // re-read on every lookup, so validate and cap it here instead of letting
    // a direct call write a megabyte-long hostname.
    const { checkUrlSyntax } = await import("@/lib/security/urls");
    const endpoint = String(baseUrl ?? "").trim();
    if (endpoint) {
      const verdict = checkUrlSyntax(endpoint);
      if (!verdict.ok) return { ok: false, message: `Base URL: ${verdict.reason}` };
    }
    // setKey throws when the key comes from the environment instead of the
    // file — that used to escape as an unhandled 500. `baseUrl` binds the
    // key to the endpoint it was entered for (fallback/image roles).
    setKey(providerId, value, hostFromUrl(endpoint));
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return fail(
      "That key could not be stored — it may be set through an environment variable.",
      error,
      "setAiKeyAction",
    );
  }
}

/**
 * The three actions below hit the provider outside `complete()`, so they
 * must pass through `withAiBudget` themselves — otherwise "test
 * connection" and "list models" were free, unlimited calls that made the
 * daily cap decorative. `getAdapter` moved inside the try too: an unknown
 * provider used to throw before the handler.
 */
export async function testAiConnectionAction(): Promise<AiConfigResult & { latencyMs?: number }> {
  try {
    const limited = await aiThrottle("test", 10);
    if (limited) return { ok: false, message: limited };
    const config = getAiConfig();
    if (!hasKey(config.provider)) return { ok: false, message: "No key configured." };
    const adapter = getAdapter(config.provider);
    const { withAiBudget } = await import("@/lib/ai/client");
    const start = Date.now();
    await withAiBudget("text", () =>
      adapter.complete(config, {
        capability: "text",
        system: "Reply with the single word: ok",
        prompt: "ping",
        temperature: 0,
        maxTokens: 8,
        timeoutMs: 20_000,
      }),
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, message: publicError("Connection failed.", error, "testAiConnectionAction") };
  }
}

export async function testProviderAction(input: {
  provider: string;
  model: string;
  baseUrl?: string;
}): Promise<AiConfigResult & { latencyMs?: number }> {
  try {
    const limited = await aiThrottle("test", 10);
    if (limited) return { ok: false, message: limited };
    const secrets = await import("@/lib/ai/secrets");
    const adapters = await import("@/lib/ai/adapters");
    const { withAiBudget } = await import("@/lib/ai/client");

    const provider = String(input.provider ?? "").trim();
    if (!adapters.ADAPTERS[provider]) return { ok: false, message: "Unknown provider." };
    if (!secrets.hasKey(provider)) {
      return { ok: false, message: "No key configured for that provider." };
    }

    const baseUrl = input.baseUrl?.trim() || undefined;
    if (baseUrl) {
      // This URL never touches the config file — it goes straight to the
      // adapter, so it is validated here as well as at save time.
      const { validateOutboundUrl } = await import("@/lib/security/urls");
      const verdict = await validateOutboundUrl(baseUrl);
      if (!verdict.ok) return { ok: false, message: verdict.reason };
    }

    const config = {
      provider,
      model: String(input.model ?? "").trim().slice(0, 200),
      baseUrl,
    } as any;
    const adapter = adapters.getAdapter(provider);
    const start = Date.now();
    await withAiBudget("text", () =>
      adapter.complete(config, {
        capability: "text",
        system: "Reply with the single word: ok",
        prompt: "ping",
        temperature: 0,
        maxTokens: 8,
        timeoutMs: 20_000,
      }),
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, message: publicError("Connection failed.", error, "testProviderAction") };
  }
}

export async function listAiModelsAction(): Promise<{ ok: boolean; models?: { id: string; label: string }[]; message?: string }> {
  try {
    const limited = await aiThrottle("models", 10);
    if (limited) return { ok: false, message: limited };
    const config = getAiConfig();
    if (!hasKey(config.provider)) return { ok: false, message: "No key configured." };
    const adapter = getAdapter(config.provider);
    const { withAiBudget } = await import("@/lib/ai/client");
    const models = await withAiBudget("text", () =>
      adapter.listModels({ ...config, baseUrl: config.baseUrl }),
    );
    return { ok: true, models: models.map((m) => ({ id: m.id, label: m.label })) };
  } catch (error) {
    return { ok: false, message: publicError("Could not list models.", error, "listAiModelsAction") };
  }
}

/** BYO_LLM §8: max 10 images, 5 MB each — enforced server-side, not just in the file picker. */
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Aggregate budget across one request: 10 × 5 MB would be a 50 MB post. */
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
/** Free text that becomes prompt tokens: cap it before it becomes spend. */
const MAX_PROMPT_CHARS = 8_000;

/** The image types every supported vision provider accepts. */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

/**
 * Identify an image from its leading bytes.
 *
 * A declared `mimeType` is client input; a `.exe` labelled `image/png` would
 * otherwise be base64-posted to the provider and stored in an error path.
 * Sniffing the header is cheap and makes the declared type a claim we check.
 */
function sniffImageType(base64: string): string | null {
  let head: Buffer;
  try {
    head = Buffer.from(base64.slice(0, 32), "base64");
  } catch {
    return null;
  }
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (head.toString("ascii", 4, 8) === "ftyp") {
    const brand = head.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
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
    const limited = await aiThrottle("extract", 20);
    if (limited) return { ok: false, message: limited };
    if (input.mode === "image") {
      const images = input.images ?? [];
      if (images.length > MAX_IMAGES) {
        return { ok: false, message: `Attach at most ${MAX_IMAGES} images.` };
      }
      let total = 0;
      for (const image of images) {
        const data = String(image?.data ?? "");
        const mime = String(image?.mimeType ?? "").toLowerCase();
        const bytes = Math.floor((data.length * 0.75));
        total += bytes;
        if (bytes > MAX_IMAGE_BYTES) {
          return { ok: false, message: "One of those images is over 5 MB." };
        }
        if (!ALLOWED_IMAGE_TYPES.has(mime)) {
          return { ok: false, message: "That image type is not supported." };
        }
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
          return { ok: false, message: "That image is not valid base64." };
        }
        const sniffed = sniffImageType(data);
        const matches =
          sniffed === mime ||
          (sniffed === "image/heic" && (mime === "image/heic" || mime === "image/heif"));
        if (!matches) {
          return { ok: false, message: "That file is not the image type it claims to be." };
        }
      }
      if (total > MAX_TOTAL_IMAGE_BYTES) {
        return { ok: false, message: "Those images add up to more than 12 MB — attach fewer." };
      }
      const proposal = await extractFoodFromImage(images, input.note?.slice(0, MAX_PROMPT_CHARS));
      return { ok: true, proposal };
    }
    const text = (input.text ?? "").slice(0, MAX_PROMPT_CHARS);
    const proposal = await extractFoodFromText(text);
    return { ok: true, proposal };
  } catch (error) {
    return { ok: false, message: publicError("Extraction failed.", error, "extractFoodAction") };
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
  // `weekStart("abc")` → Invalid Date → `toISOString()` throws RangeError
  // out of the action. Validate the shape before any date math (the add
  // and move actions already do this via isDay).
  if (!isDay(sourceDay) || !isDay(targetDay)) {
    return { ok: false, message: "That date is not valid." };
  }
  try {
    const sourceWeek = weekStart(sourceDay);
    const targetWeek = weekStart(targetDay);
    if (!weekDays(sourceWeek).includes(sourceDay)) return { ok: false, message: "Invalid source day." };
    if (!weekDays(targetWeek).includes(targetDay)) return { ok: false, message: "Invalid target day." };

    const sourcePlan = getOrCreatePlan(sourceWeek);
    const targetPlan = getOrCreatePlan(targetWeek);
    const entries = listPlanEntries(sourcePlan.id).filter((e) => e.day === sourceDay);

    // One transaction: a failure halfway through used to leave the target
    // day with a partial copy, which looks like data loss to the user.
    const count = transaction(() => {
      let copied = 0;
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
        copied++;
      }
      return copied;
    });

    revalidatePath("/plan");
    revalidatePath("/");
    return { ok: true, count };
  } catch (error) {
    return { ...fail("Could not copy that day.", error, "copyPlanDayAction") };
  }
}

export async function copyPlanWeekAction(
  sourceWeekStart: string,
  targetWeekStart: string,
): Promise<{ ok: boolean; message?: string; count?: number }> {
  const { weekStart, weekDays } = await import("@/lib/plan");
  if (!isDay(sourceWeekStart) || !isDay(targetWeekStart)) {
    return { ok: false, message: "That date is not valid." };
  }
  try {
    // Normalise to the Monday of each week. The plan row is keyed by the
    // raw string, so a non-Monday input used to create an orphan plan and
    // copy nothing while still reporting success.
    const sourceWeek = weekStart(sourceWeekStart);
    const targetWeek = weekStart(targetWeekStart);
    if (sourceWeek === targetWeek) {
      return { ok: false, message: "Pick a different week to copy into." };
    }
    const sourceDays = weekDays(sourceWeek);
    const targetDays = weekDays(targetWeek);
    if (sourceDays.length !== 7 || targetDays.length !== 7) {
      return { ok: false, message: "Invalid week." };
    }

    const sourcePlan = getOrCreatePlan(sourceWeek);
    const targetPlan = getOrCreatePlan(targetWeek);
    const sourceEntries = listPlanEntries(sourcePlan.id);

    // One transaction so a mid-week failure cannot leave a partial copy.
    const count = transaction(() => {
      let copied = 0;
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
        copied++;
      }
      return copied;
    });

    revalidatePath("/plan");
    revalidatePath("/");
    return { ok: true, count };
  } catch (error) {
    return { ...fail("Could not copy that week.", error, "copyPlanWeekAction") };
  }
}

export async function promoteFoodToRecipeAction(foodId: string): Promise<{ ok: boolean; recipeId?: string; message?: string }> {
  const food = getFood(foodId);
  if (!food) return { ok: false, message: "That food does not exist." };
  const resolved = resolveDefaultAmount(food.id) ?? { amount: 100, unit: "g" };
  const parsed = parseUnitKey(resolved.unit);
  const converted = toGrams(food, {
    amount: resolved.amount,
    unit: parsed.unit,
    portionLabel: parsed.portionLabel,
  });
  const draft: RecipeDraft = {
    name: food.name,
    instructions: "",
    servings: 1,
    blocks: [
      {
        name: "Main",
        operation: null,
        outputGrams: converted.ok ? converted.grams : 100,
        inputs: [
          {
            foodId: food.id,
            amount: resolved.amount,
            unit: resolved.unit,
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
    const { rateLimit } = await import("@/lib/security/rate-limit");
    // Each of these costs an upstream call and can stall a socket for 10 s;
    // without a window, a loop eats the shared DEMO_KEY quota.
    const budget = rateLimit("off:barcode", 30, 60_000);
    if (!budget.ok) {
      return { ok: false, message: `Too many lookups — try again in ${budget.retryAfter}s.` };
    }
    const product = await lookupBarcode(barcode);
    if (!product) return { ok: false, message: "Not found in Open Food Facts. Try a different barcode or add it manually." };
    return { ok: true, proposal: offToInput(product) };
  } catch (error) {
    return { ...fail("Lookup failed.", error, "lookupBarcodeAction") };
  }
}

import { searchUsda, usdaToInput } from "@/lib/food-sources/usda";

export async function searchUsdaAction(query: string): Promise<{
  ok: boolean;
  results?: { fdcId: number; name: string; category?: string; nutrients: number }[];
  message?: string;
}> {
  try {
    const { rateLimit } = await import("@/lib/security/rate-limit");
    const budget = rateLimit("usda:search", 30, 60_000);
    if (!budget.ok) {
      return { ok: false, message: `Too many searches — try again in ${budget.retryAfter}s.` };
    }
    const foods = await searchUsda(String(query ?? "").slice(0, 200));
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
    return { ...fail("Search failed.", error, "searchUsdaAction") };
  }
}

export async function importUsdaAction(fdcId: number): Promise<{ ok: boolean; proposal?: any; message?: string }> {
  try {
    // Interpolated into `https://api.nal.usda.gov/fdc/v1/food/${fdcId}`:
    // the host is fixed, but a string-typed value could reshape the path
    // and query. Only a positive integer is a food id.
    const id = Number(fdcId);
    if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) {
      return { ok: false, message: "That food id is not valid." };
    }
    const { rateLimit } = await import("@/lib/security/rate-limit");
    const budget = rateLimit("usda:import", 30, 60_000);
    if (!budget.ok) {
      return { ok: false, message: `Too many imports — try again in ${budget.retryAfter}s.` };
    }
    const { getUsdaFood, usdaToInput } = await import("@/lib/food-sources/usda");
    const food = await getUsdaFood(id);
    if (!food) return { ok: false, message: "That food could not be loaded." };
    return { ok: true, proposal: usdaToInput(food) };
  } catch (error) {
    return { ...fail("Import failed.", error, "importUsdaAction") };
  }
}

/** Pasted CSV used to arrive unbounded — only the framework's 1 MB cap applied. */
const MAX_IMPORT_CSV_CHARS = 400_000;
const MAX_IMPORT_ERRORS = 50;

export async function importInndbAction(
  csvText: string,
  mappingJson?: string,
): Promise<{ ok: boolean; imported?: number; skipped?: number; errors?: { row: number; name: string; message: string }[]; message?: string }> {
  try {
    if (typeof csvText !== "string" || csvText.length === 0) {
      return { ok: false, message: "Paste a CSV to import." };
    }
    if (csvText.length > MAX_IMPORT_CSV_CHARS) {
      return { ok: false, message: "That CSV is too large — import it in smaller batches." };
    }
    const { importInndb, DEFAULT_INNDB_MAPPING } = await import("@/lib/importer/inndb");
    let mapping: import("@/lib/importer/inndb").InndbMapping = DEFAULT_INNDB_MAPPING;
    if (mappingJson) {
      if (mappingJson.length > 10_000) {
        return { ok: false, message: "That column mapping is too large." };
      }
      const parsed = JSON.parse(mappingJson);
      // Shape-check before it drives column lookups: unknown keys are
      // ignored downstream, but the name field must be a usable string and
      // `nutrients` must be a small map of known codes. A string there used
      // to be enumerated per row.
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, message: "That column mapping is not valid." };
      }
      for (const key of ["name", "aliases", "category", "code", "defaultCategory", "defaultKind"]) {
        if (parsed[key] !== undefined && typeof parsed[key] !== "string") {
          return { ok: false, message: "That column mapping is not valid." };
        }
      }
      const nutrients = parsed.nutrients;
      if (nutrients !== undefined) {
        const { NUTRIENT_CODES } = await import("@/lib/nutrition/types");
        const codes = new Set<string>(NUTRIENT_CODES);
        if (!nutrients || typeof nutrients !== "object" || Array.isArray(nutrients)) {
          return { ok: false, message: "That column mapping is not valid." };
        }
        const entries = Object.entries(nutrients);
        if (entries.length > 40) {
          return { ok: false, message: "That column mapping has too many nutrients." };
        }
        for (const [column, code] of entries) {
          if (typeof code !== "string" || !codes.has(code)) {
            return { ok: false, message: "That column mapping names an unknown nutrient." };
          }
          if (column.length > 200) {
            return { ok: false, message: "That column mapping is not valid." };
          }
        }
      }
      mapping = parsed as import("@/lib/importer/inndb").InndbMapping;
    }
    const result = importInndb(csvText, mapping);
    revalidatePath("/foods");
    return {
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors.slice(0, MAX_IMPORT_ERRORS),
    };
  } catch (error) {
    return { ...fail("Import failed.", error, "importInndbAction") };
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
import { sanitizeGraph, sanitizeLayout, validateGraphShape, validateLayout } from "@/lib/nutrition/graph-validate";

/**
 * A graph arrives from the client as JSON with no size limit beyond the
 * framework body cap — 1 MB of nodes means a full recompute plus a
 * multi-megabyte snapshot write. `validateGraphShape` bounds the shape
 * (counts, per-node outputs, grams, factors, layout), not just the bytes.
 */
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
  try {
    const graphProblem = validateGraphShape(input?.graph);
    if (graphProblem) return { ok: false, message: graphProblem };
    const layoutProblem = validateLayout(input.layout);
    if (layoutProblem) return { ok: false, message: layoutProblem };
    // Validation bounds counts and ranges; this drops any extra keys a
    // caller attached to a node or layout position before they are stored.
    const graph = sanitizeGraph(input.graph);
    const layout = sanitizeLayout(input.layout);
    if (input.mode !== undefined && input.mode !== "new-version" && input.mode !== "replace-current") {
      return { ok: false, message: "Unknown save mode." };
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) return { ok: false, message: "Give the recipe a name." };
    if (name.length > 200) return { ok: false, message: "That recipe name is too long." };
    const versionLabel =
      typeof input.versionLabel === "string" ? input.versionLabel.trim() : null;
    if (versionLabel && versionLabel.length > 120) {
      return { ok: false, message: "That version label is too long." };
    }
    const instructions = typeof input.instructions === "string" ? input.instructions : "";
    if (instructions.length > 20_000) {
      return { ok: false, message: "Those instructions are too long to save." };
    }
    const servings = Number(input.servings);
    if (!Number.isFinite(servings) || servings <= 0 || servings > MAX_SERVINGS) {
      return { ok: false, message: "Servings must be a positive number." };
    }
    const result = saveGraphDraft({
      recipeId: input.recipeId ?? null,
      name,
      versionLabel,
      instructions,
      servings,
      layout,
      graph,
      mode: input.mode,
      replaceVersionId: input.replaceVersionId ?? null,
    });
    if (!result.ok) return { ok: false, message: result.message };
    revalidatePath("/recipes");
    revalidatePath(`/recipes/${result.recipeId}`);
    return { ok: true, recipeId: result.recipeId };
  } catch (error) {
    return { ...fail("Could not save that recipe.", error, "saveGraphAction") };
  }
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
    const limited = await aiThrottle("estimate", 30);
    if (limited) return { ok: false, message: limited };
    if (!Array.isArray(input?.inputs) || input.inputs.length > 60) {
      return { ok: false, message: "That step has too many ingredients to estimate." };
    }
    if (typeof input.operation !== "string" || input.operation.length > 60) {
      return { ok: false, message: "That step name is not valid." };
    }
    const config = getAiConfig();
    if (!(await import("@/lib/ai/secrets")).hasKey(config.provider)) {
      return { ok: false, message: "No key configured. Add one in Settings." };
    }
    const estimate = await estimateNodeDeltas(input);
    return { ok: true, estimate };
  } catch (error) {
    return { ...fail("Estimation failed.", error, "estimateNodeDeltasAction") };
  }
}

import { convertAllLegacyRecipes } from "@/lib/legacy-convert";

export async function convertAllRecipesToV2Action(): Promise<{ ok: boolean; converted?: number; skipped?: number; errors?: { name: string; message: string }[]; message?: string }> {
  try {
    const result = convertAllLegacyRecipes();
    revalidatePath("/recipes");
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, message: publicError("Conversion failed.", error) };
  }
}

import { planRecipeFromPrompt, materializeRecipe, type RecipePlan } from "@/lib/ai-generate-recipe";
import { resolvePlanFoods, type PlanFoodResolution } from "@/lib/ai/food-resolve";

export async function previewRecipeFromPromptAction(
  input: { prompt: string; recipeId?: string | null },
): Promise<{ ok: boolean; plan?: RecipePlan; resolutions?: PlanFoodResolution[]; message?: string }> {
  if (typeof input?.prompt !== "string" || !input.prompt.trim()) {
    return { ok: false, message: "Ask for a dish first." };
  }
  if (input.prompt.length > 8_000) {
    return { ok: false, message: "Keep the request under 8,000 characters." };
  }
  try {
    const limited = await aiThrottle("plan", 10);
    if (limited) return { ok: false, message: limited };
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
      message: publicError("Could not plan that recipe.", error, "previewRecipeFromPromptAction"),
    };
  }
}

export async function createRecipeFromPlanAction(
  input: RecipePlan & {
    recipeId?: string | null;
    mode?: "new-version" | "replace-current";
    replaceVersionId?: string | null;
    /** Fill missing ingredient nutrition with AI after the save (default: true). */
    fillMissingNutrition?: boolean;
  },
): Promise<{ ok: boolean; recipeId?: string; message?: string }> {
  try {
    const limited = await aiThrottle("materialize", 10);
    if (limited) return { ok: false, message: limited };
    // The plan arrives from the client here, fully attacker-controlled:
    // validate its shape (operations, weights, servings, step count)
    // before it can become a stored graph.
    const { validateRecipePlan } = await import("@/lib/ai-generate-recipe");
    const valid = validateRecipePlan(input);
    if (!valid.ok) return { ok: false, message: valid.message };

    if (input.mode !== undefined && input.mode !== "new-version" && input.mode !== "replace-current") {
      return { ok: false, message: "Unknown save mode." };
    }
    if (input.recipeId != null && typeof input.recipeId !== "string") {
      return { ok: false, message: "That recipe id is not valid." };
    }
    if (input.replaceVersionId != null && typeof input.replaceVersionId !== "string") {
      return { ok: false, message: "That version id is not valid." };
    }

    const base = valid.plan;
    const saved = await materializeRecipe(base, input.recipeId ?? undefined, {
      mode: input.mode,
      replaceVersionId: input.replaceVersionId ?? null,
    });
    const { recipeId, fillTargets } = saved;
    revalidatePath("/recipes");
    if (input.recipeId) revalidatePath(`/recipes/${input.recipeId}`);

    // Nutrition fill is one LLM call per unknown ingredient — slow, and
    // non-essential to the save itself. Schedule it after the response so
    // the recipe (and the button) never wait on the model. Failures are
    // non-fatal: foods stay unknown and can be filled from Foods later.
    if (input.fillMissingNutrition !== false && fillTargets.length > 0) {
      after(async () => {
        try {
          const { fillAllWithAi } = await import("@/lib/ai/estimate-food");
          await fillAllWithAi({ foodIds: fillTargets });
        } catch {
          /* nutrition stayed as-is */
        }
        revalidatePath("/recipes");
        revalidatePath(`/recipes/${recipeId}`);
      });
    }

    return { ok: true, recipeId };
  } catch (error) {
    return {
      ok: false,
      message: publicError("Could not create the recipe.", error),
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
  if (servings > MAX_SERVINGS) {
    return { ok: false, message: `Servings must be ${MAX_SERVINGS} or fewer.` };
  }

  // Grams are a convenience for display (per-serving input mass).
  const snapshot = version.snapshot as unknown as { inputGrams?: number };
  const perServing = input.servings === 0 ? 1 : snapshot.inputGrams ? snapshot.inputGrams / version.servings : 0;
  const totalGrams = Number.isFinite(perServing * servings) ? perServing * servings : 0;

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
import { getMasterPrompt, setMasterPrompt, resetMasterPrompt, setTargetRules, resetTargetRules } from "@/lib/db/settings";
import { DEFAULT_TARGET_RULES, type TargetRules } from "@/lib/targets";
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

  const limited = await aiThrottle("estimate-food", 20);
  if (limited) return { ok: false, message: limited };

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
      message: publicError("The estimate failed.", error),
    };
  }
}

export async function saveMasterPromptAction(
  value: string,
): Promise<{ ok: boolean; message?: string }> {
  if (typeof value !== "string") {
    return { ok: false, message: "That prompt is not valid." };
  }
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

/**
 * Save the colour thresholds and per-nutrient overrides.
 *
 * The payload is user content, so it is parsed rather than trusted:
 * unknown nutrient codes are dropped, percentages are clamped, and red is
 * kept at or above amber. Returning the normalized rules lets the panel
 * show what was actually stored instead of what was typed.
 */
export async function saveTargetRulesAction(
  input: unknown,
): Promise<{ ok: boolean; message?: string; rules?: TargetRules }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Those thresholds are not valid." };
  }

  const rules = setTargetRules(input);
  revalidatePath("/");
  revalidatePath("/plan");
  revalidatePath("/profile");
  revalidatePath("/settings");
  revalidatePath("/about");
  return { ok: true, rules };
}

export async function resetTargetRulesAction(): Promise<{ ok: boolean; rules: TargetRules }> {
  resetTargetRules();
  revalidatePath("/");
  revalidatePath("/plan");
  revalidatePath("/profile");
  revalidatePath("/settings");
  revalidatePath("/about");
  return { ok: true, rules: DEFAULT_TARGET_RULES };
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
    const limited = await aiThrottle("estimate-batch", 5);
    if (limited) return { ok: false, message: limited };
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
      message: publicError("The batch estimate failed.", error),
    };
  }
}
