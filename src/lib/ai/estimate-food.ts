/**
 * AI estimation of nutrient values for a single food (D-043 companion).
 *
 * The model proposes per-100 g amounts for nutrients the app does not know,
 * each tagged with a reason and a confidence. The engine disposes:
 *  - only nutrients that are currently `unknown` ever receive a value;
 *  - physically absurd amounts are dropped;
 *  - every fill lands as `estimated`, never `known`, and carries the model
 *    id in `method` so the UI can show provenance and the user can override.
 */

import { complete, getAiConfig } from "./client";
import { asData, withMaster, DATA_PREAMBLE, PROMPT_LIMITS } from "./prompt";
import { NUTRIENTS, NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";
import type { Food } from "@/lib/nutrition/types";
import { getMasterPrompt } from "@/lib/db/settings";

export interface NutrientFill {
  code: NutrientCode;
  amount: number;
  confidence: "low" | "medium" | "high";
  reason: string;
}

export interface FoodEstimate {
  fills: NutrientFill[];
  notes: string;
  /** "<provider>:<model>" from the ai_calls-adjacent config, for provenance. */
  model: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    values: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nutrient: { type: "string", enum: [...NUTRIENT_CODES] },
          amountPer100g: { type: "number" },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["nutrient", "amountPer100g", "reason", "confidence"],
      },
    },
    notes: { type: "string" },
  },
  required: ["values", "notes"],
} as const;

const SYSTEM = `You are a food scientist estimating per-100 g nutrient values for a food.
Rules:
- Return ONLY the JSON object, no prose.
- Only report values you have a real-world basis for (IFCT, USDA, branded-label-ish reasoning, typical composition). OMIT anything you cannot justify. An empty values array is a perfectly good answer.
- amountPer100g means per 100 g edible portion, matching the food's basis.
- Sanity bounds: energy ≤ 900 kcal/100 g; everything else ≤ 1,000 mg-ish per 100 g unless the unit is kcal. Never a negative number.
- Never report a nutrient that is already known for this food (it will be listed under "already known").
- Prefer regional/cuisine-specific knowledge where it differs from global tables. Reasons should say where the estimate comes from (e.g. "IFCT-ish typical for moong dal, cooked").
- Be honest about low confidence; "low" costs nothing.`;

export type CompleteFn = typeof complete;

export interface EstimateOptions {
  completeFn?: CompleteFn;
  masterPrompt?: string | null;
  /**
   * Restrict the fill to these nutrients. Known/estimated nutrients are
   * never filled regardless; an empty set fills nothing.
   */
  codes?: ReadonlySet<NutrientCode> | null;
}

/** Codes whose value is missing (status !== "known", amount null). */
export function missingNutrients(food: Food): NutrientCode[] {
  return NUTRIENT_CODES.filter((code) => {
    const entry = food.nutrients[code];
    return entry == null || entry.amount == null;
  });
}

/**
 * Intersection helper: which of `wanted` are currently missing for this
 * food. The client picks nutrients it *thinks* are missing; the server
 * re-checks against fresh state so concurrent edits don't get re-estimated.
 */
export function selectedMissing(
  food: Food,
  wanted?: ReadonlySet<NutrientCode> | null,
): NutrientCode[] {
  const missing = missingNutrients(food);
  return wanted ? missing.filter((code) => wanted.has(code)) : missing;
}

/**
 * Drop anything that is not a tracked nutrient code. Empty array means the
 * caller sent a selection with nothing usable in it — callers treat that as
 * a no-op rather than a full fill.
 */
export function sanitizeNutrientCodes(input: unknown): NutrientCode[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set(NUTRIENT_CODES);
  const seen = new Set<NutrientCode>();
  for (const item of input) {
    if (typeof item === "string" && valid.has(item as NutrientCode)) {
      seen.add(item as NutrientCode);
    }
  }
  return [...seen];
}

export async function estimateNutrients(
  food: Food,
  opts: EstimateOptions = {},
): Promise<FoodEstimate> {
  const completeFn = opts.completeFn ?? complete;
  const masterPrompt = opts.masterPrompt ?? getMasterPrompt();

  // The client picks; the server re-checks against fresh state.
  const missing = selectedMissing(food, opts.codes);
  if (missing.length === 0) {
    const cfg = getAiConfig();
    return { fills: [], notes: "", model: `${cfg.provider}:${cfg.model}` };
  }
  const already = NUTRIENT_CODES.filter((code) => !missing.includes(code));
  const knownLines = already
    .map((code) => {
      const v = food.nutrients[code];
      return `${code}: ${v.amount} (${v.status})`;
    })
    .filter((line) => !line.endsWith(": null (unknown)"))
    .join("\n");

  // Food names and aliases come from the user, from USDA, from Open Food
  // Facts and from earlier model output — all untrusted in a prompt. They
  // are tagged as data rather than interpolated raw.
  const identity = [
    `Food: ${food.name}`,
    food.aliases.length ? `Also known as: ${food.aliases.join(", ")}` : null,
    `Category: ${food.category} · state: ${food.state} · kind: ${food.kind} · basis: ${food.basis ?? "per_100g"}`,
    food.densityGPerMl ? `Density: ${food.densityGPerMl} g/ml` : null,
    food.servingSizeG ? `Serving size: ${food.servingSizeG} g` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const userPrompt = [
    DATA_PREAMBLE,
    asData("food", identity, PROMPT_LIMITS.name * 6),
    "",
    "Missing nutrients to estimate (per 100 g):",
    ...missing.map((code) => `- ${NUTRIENTS[code].label} [${code}] (unit: ${NUTRIENTS[code].unit})`),
    "",
    "Already known (do NOT report these):",
    knownLines || "(nothing)",
    "",
    "Return the JSON object now.",
  ].join("\n");

  const response = await completeFn({
    capability: "text",
    // The master prompt lives in the system turn here exactly as it does in
    // recipe planning, extraction and retention estimation.
    system: withMaster(SYSTEM, masterPrompt),
    prompt: userPrompt,
    jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
    maxTokens: 2048,
  });

  const raw = response.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: { values: Array<{ nutrient: string; amountPer100g: number; reason: string; confidence: string }>; notes?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The model did not return usable JSON.");
  }
  if (!Array.isArray(parsed?.values)) {
    throw new Error("The model returned no values array.");
  }

  const missingSet = new Set(missing);
  const fills: NutrientFill[] = [];
  const cfg = getAiConfig();
  const model = `${cfg.provider}:${cfg.model}`;
  for (const entry of parsed.values) {
    const code = entry.nutrient as NutrientCode;
    if (!NUTRIENT_CODES.includes(code)) continue;
    if (!missingSet.has(code)) continue; // never overwrite known/estimated
    const amount = Number(entry.amountPer100g);
    if (!Number.isFinite(amount) || amount < 0) continue;
    // Sanity bounds; energy cannot exceed pure fat.
    if (code === "ENERC_KCAL" && amount > 900) continue;
    if (NUTRIENTS[code].unit !== "kcal" && amount > 1000) continue;
    const confidence = ["low", "medium", "high"].includes(entry.confidence)
      ? (entry.confidence as "low" | "medium" | "high")
      : "low";
    fills.push({
      code,
      amount,
      confidence,
      reason: String(entry.reason ?? "").slice(0, 300),
    });
  }

  return { fills, notes: String(parsed.notes ?? "").slice(0, 500), model };
}

import { listFoods, fillEstimatedCapturedFood } from "@/lib/db/foods";

/**
 * Estimate every captured food that still has unknown nutrients.
 *
 * One LLM call per food (all missing nutrients bundled into one prompt),
 * never one call per nutrient, and never a value that is already known.
 * Capped so one run cannot drain a free-tier quota in a loop.
 */
export async function fillAllWithAi(opts: {
  completeFn?: CompleteFn;
  masterPrompt?: string | null;
  maxFoods?: number;
  /** Restrict to this set of food ids (e.g. the ingredients of one recipe). */
  foodIds?: string[];
  /** Restrict to this set of nutrient codes. Empty array fills nothing. */
  nutrientCodes?: NutrientCode[];
} = {}): Promise<{
  foodsEstimated: number;
  nutritionEntries: number;
  skipped: number;
  failed: Array<{ name: string; reason: string }>;
}> {
  if (opts.nutrientCodes && opts.nutrientCodes.length === 0) {
    return { foodsEstimated: 0, nutritionEntries: 0, skipped: 0, failed: [] };
  }
  const wanted = opts.nutrientCodes ? new Set(opts.nutrientCodes) : null;
  const foods = listFoods().filter((food) => food.source); // captured only
  const pending = foods.filter(
    (food) =>
      (!opts.foodIds || opts.foodIds.includes(food.id)) &&
      NUTRIENT_CODES.some(
        (code) => food.nutrients[code]?.amount == null && (!wanted || wanted.has(code)),
      ),
  );
  const cap = opts.maxFoods ?? 50;
  const failed: Array<{ name: string; reason: string }> = [];
  let nutritionEntries = 0;
  let foodsEstimated = 0;
  let skipped = 0;

  const codes = opts.nutrientCodes ? new Set(opts.nutrientCodes) : null;
  for (const food of pending.slice(0, cap)) {
    try {
      const estimate = await estimateNutrients(food, { ...opts, codes });
      if (estimate.fills.length === 0) {
        skipped += 1;
        continue;
      }
      const result = fillEstimatedCapturedFood(food.id, estimate.fills.map((fill) => ({
        code: fill.code,
        amount: fill.amount,
        confidence: fill.confidence,
        reason: fill.reason,
        model: estimate.model,
      })));
      if (result.filled > 0) nutritionEntries += result.filled;
      else skipped += 1;
      foodsEstimated += 1;
    } catch (error) {
      failed.push({ name: food.name, reason: error instanceof Error ? error.message : "failed" });
    }
  }

  return { foodsEstimated, nutritionEntries, skipped, failed };
}
