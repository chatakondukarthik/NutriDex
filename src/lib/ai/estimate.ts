/**
 * LLM estimation of nutrient changes per process node (D-043).
 *
 * The model proposes retention factors per nutrient for an operation given
 * the inputs. Table rows and user overrides always win; estimates fill
 * gaps only. Every estimate is tagged `estimated`, carries a reason, and
 * is revertible in the UI.
 */

import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { complete } from "./client";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";

export interface NodeEstimate {
  factors: { nutrient: NutrientCode; factor: number; reason: string; confidence: "low" | "medium" | "high" }[];
  notes: string;
}

export interface EstimateInput {
  operation: string;
  qualifier?: string | null;
  inputs: { name: string; grams: number; kcalPer100g: number | null }[];
}

const SCHEMA = {
  type: "object",
  properties: {
    factors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nutrient: { type: "string", enum: [...NUTRIENT_CODES] },
          factor: { type: "number", minimum: 0, maximum: 2 },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["nutrient", "factor", "reason", "confidence"],
      },
    },
    notes: { type: "string" },
  },
  required: ["factors", "notes"],
} as const;

const SYSTEM = `You are a food scientist estimating how a cooking operation changes the nutrients in a dish.
Rules:
- Return ONLY the JSON object, no prose.
- Report a retention factor (fraction retained, 0..2) for each tracked nutrient you have evidence for; OMIT the rest. Never invent a factor for a nutrient you cannot reason about.
- Heat-labile vitamins (C, FOL, B6, B12) and leachable minerals (NA, K, CA, MG) change most.
- Blending and mixing change nothing measurable — return an empty factors array with a note saying so.
- Cooking water losses only matter when the water is discarded ("drained"). Say which in reasons.
- Never claim more precision than you have.`;

export function estimateCacheKey(input: EstimateInput): string {
  const fingerprint = {
    op: input.operation,
    q: input.qualifier ?? null,
    inputs: [...input.inputs].map((i) => [i.name, Math.round(i.grams)]).sort(),
  };
  return createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
}

export function readCachedEstimate(key: string): NodeEstimate | null {
  const row = db
    .prepare(`SELECT payload FROM estimate_cache WHERE cache_key = ?`)
    .get(key) as unknown as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as NodeEstimate;
  } catch {
    return null;
  }
}

export function writeCachedEstimate(key: string, operation: string, estimate: NodeEstimate): void {
  db.prepare(
    `INSERT OR REPLACE INTO estimate_cache (cache_key, operation, payload, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(key, operation, JSON.stringify(estimate), new Date().toISOString());
}

export type CompleteFn = (request: Parameters<typeof complete>[0]) => ReturnType<typeof complete>;

export async function estimateNodeDeltas(
  input: EstimateInput,
  completeFn: CompleteFn = complete,
): Promise<NodeEstimate> {
  const key = estimateCacheKey(input);
  const cached = readCachedEstimate(key);
  if (cached) return cached;

  const lines = input.inputs
    .map((i) => `- ${i.name}: ${Math.round(i.grams)} g${i.kcalPer100g != null ? ` (~${i.kcalPer100g} kcal/100 g)` : ""}`)
    .join("\n");

  const response = await completeFn({
    capability: "text",
    system: SYSTEM,
    prompt: `Operation: ${input.operation}${input.qualifier ? ` (${input.qualifier})` : ""}\nInputs:\n${lines}\n\nReturn the JSON object now.`,
    jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
    maxTokens: 1024,
  });

  const parsed = parseEstimate(response.text);
  writeCachedEstimate(key, input.operation, parsed);
  return parsed;
}

export function parseEstimate(raw: string): NodeEstimate {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model did not return JSON.");
    parsed = JSON.parse(match[0]);
  }
  const obj = parsed as Record<string, unknown>;
  const factors: NodeEstimate["factors"] = [];
  if (Array.isArray(obj.factors)) {
    for (const f of obj.factors) {
      if (!f || typeof f !== "object") continue;
      const nutrient = String((f as any).nutrient);
      if (!(NUTRIENT_CODES as readonly string[]).includes(nutrient)) continue;
      const factor = Number((f as any).factor);
      if (!Number.isFinite(factor) || factor < 0) continue;
      factors.push({
        nutrient: nutrient as NutrientCode,
        factor,
        reason: String((f as any).reason ?? ""),
        confidence: ["low", "medium", "high"].includes(String((f as any).confidence))
          ? ((f as any).confidence as "low" | "medium" | "high")
          : "low",
      });
    }
  }
  return { factors, notes: typeof obj.notes === "string" ? obj.notes : "" };
}
