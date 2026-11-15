import { complete } from "./client";
import type { ImagePart } from "./types";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";
import { effectFromRetention } from "@/lib/process-retention";
import type { ProcessEffect, ProcessOperation } from "@/lib/recipe-graph";

const SCHEMA = {
  type: "object",
  properties: {
    retention: {
      type: "object",
      properties: Object.fromEntries(NUTRIENT_CODES.map((c) => [c, { type: "number" }])),
      additionalProperties: false,
    },
    added: {
      type: "object",
      properties: Object.fromEntries(NUTRIENT_CODES.map((c) => [c, { type: "number" }])),
      additionalProperties: false,
    },
    removed: {
      type: "object",
      properties: Object.fromEntries(NUTRIENT_CODES.map((c) => [c, { type: "number" }])),
      additionalProperties: false,
    },
    rationale: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["rationale"],
  additionalProperties: false,
};

const SYSTEM = `You estimate how a cooking process changes nutrients. You return ONLY a JSON object.

Rules:
- retention: per-nutrient factor (1.0 = unchanged, 0.7 = 30% loss). Only include nutrients you have a real reason to change.
- added: nutrients added per 100 g of output (e.g. oil absorbed). Omit if none.
- removed: nutrients removed per 100 g of output (e.g. drained whey). Omit if none.
- Only propose factors for nutrients that are known (present in the before profile). Never invent values for unknown nutrients.
- rationale: one short sentence.
- confidence: 0..1, how sure you are.`;

export async function estimateProcessEffect(input: {
  operation: ProcessOperation;
  ingredients: string[];
  beforeSummary: string;
  outputMassG: number | null;
}): Promise<ProcessEffect> {
  // Start from reference data if available.
  const base = effectFromRetention(input.operation);
  const response = await complete({
    capability: "text",
    system: SYSTEM,
    prompt: `Operation: ${input.operation}\nIngredients: ${input.ingredients.join(", ")}\nBefore: ${input.beforeSummary}\nOutput mass: ${input.outputMassG ?? "unknown"} g\n\nReturn the JSON object now.`,
    jsonSchema: SCHEMA,
    temperature: 0,
    maxTokens: 1024,
  });

  let parsed: any;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    const m = response.text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("The model did not return JSON.");
    parsed = JSON.parse(m[0]);
  }

  const retention: ProcessEffect["retention"] = { ...base.retention };
  if (parsed.retention && typeof parsed.retention === "object") {
    for (const code of NUTRIENT_CODES) {
      const v = parsed.retention[code];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 2) {
        retention[code] = v;
      }
    }
  }

  const added: ProcessEffect["added"] = {};
  if (parsed.added && typeof parsed.added === "object") {
    for (const code of NUTRIENT_CODES) {
      const v = parsed.added[code];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) added[code] = v;
    }
  }

  const removed: ProcessEffect["removed"] = {};
  if (parsed.removed && typeof parsed.removed === "object") {
    for (const code of NUTRIENT_CODES) {
      const v = parsed.removed[code];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) removed[code] = v;
    }
  }

  return {
    operation: input.operation,
    retention,
    added,
    removed,
    source: Object.keys(parsed.retention ?? {}).length > 0 ? "estimated" : base.source,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : base.rationale,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
  };
}
