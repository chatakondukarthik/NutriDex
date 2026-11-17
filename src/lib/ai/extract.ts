import { complete } from "./client";
import { asData, withMaster, DATA_PREAMBLE, PROMPT_LIMITS } from "./prompt";
import type { ImagePart } from "./types";
import type { CapturedFoodInput, CapturedPortionInput } from "@/lib/captured-food";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";

/**
 * The schema the model must answer with. It is intentionally a subset of
 * `CapturedFoodInput` — the model proposes, `resolve` normalises.
 */
export const FOOD_PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    category: { type: "string" },
    kind: { type: "string", enum: ["raw", "branded", "composite", "provisional"] },
    state: { type: "string", enum: ["raw", "cooked"] },
    basis: { type: "string", enum: ["per_100g", "per_serving", "per_pack"] },
    servingSizeG: { type: "number" },
    servingsPerPack: { type: "number" },
    portions: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, grams: { type: "number" } },
        required: ["label", "grams"],
        additionalProperties: false,
      },
    },
    nutrients: {
      type: "object",
      properties: Object.fromEntries(
        NUTRIENT_CODES.map((code) => [code, { type: "number" }]),
      ),
      additionalProperties: false,
    },
    estimated: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
  required: ["name"],
  additionalProperties: false,
} as const;

export interface FoodProposal {
  name: string;
  aliases?: string[];
  category?: string;
  kind?: CapturedFoodInput["kind"];
  state?: CapturedFoodInput["state"];
  basis?: CapturedFoodInput["basis"];
  servingSizeG?: number;
  servingsPerPack?: number;
  portions?: CapturedPortionInput[];
  nutrients?: Partial<Record<NutrientCode, number>>;
  estimated?: NutrientCode[];
  rationale?: string;
}

const SYSTEM = `You are a nutrition data extractor. You read a food description or a nutrition label and return ONE JSON object matching the schema. You never invent numbers.

Rules you must follow:
1. Return ONLY the JSON object. No markdown, no prose, no code fences.
2. Fill every field you can honestly fill. An empty result is a failure.
   - name: the common food name (e.g. "Paneer", "Whole milk").
   - category: one of Dairy, Grains, Vegetables, Fruits, Legumes, Oils, Nuts, Meat, Seafood, Spices, Beverages, or Custom.
   - kind: "branded" for packaged foods, "raw" for single ingredients, "composite" for mixed dishes, "provisional" only if you are guessing.
   - state: "raw" unless the food is cooked/ready to eat.
   - basis: "per_100g" for labels that say per 100 g; "per_serving" if the panel is per serving; "per_pack" if per pack.
   - servingSizeG: the serving weight in grams when the label gives one.
   - aliases: common alternate names, local names, or synonyms (at least one if you know any).
   - portions: household measures with their gram weight (e.g. {"label":"1 katori","grams":100}).
   - nutrients: every nutrient the label or description states, using the exact codes. Amounts per the declared basis.
   - estimated: list the codes of any value you had to guess or compute instead of reading.
   - rationale: one short sentence saying where the values came from.
3. If a nutrient is not stated, OMIT it. Never write 0 for an unknown nutrient. Unknown is a valid answer.
4. Do not round aggressively. Keep the label's precision.
5. Never include a food id, a database key, or any field outside the schema.
6. If the input is unusable, return {"name": ""} and nothing else.`;

export async function extractFoodFromText(text: string): Promise<FoodProposal> {
  const response = await complete({
    capability: "text",
    system: withMaster(SYSTEM),
    prompt: `${DATA_PREAMBLE}\n${asData("description", text, PROMPT_LIMITS.request)}\n\nReturn the JSON object now.`,
    jsonSchema: FOOD_PROPOSAL_SCHEMA,
    temperature: 0,
    maxTokens: 4096,
  });
  return parseProposal(response.text);
}

export async function extractFoodFromImage(
  images: ImagePart[],
  note?: string,
): Promise<FoodProposal> {
  const response = await complete({
    capability: "vision",
    system: withMaster(SYSTEM),
    prompt:
      `Read the nutrition label in the image and extract a food record.\n` +
      `${DATA_PREAMBLE}\n` +
      `${note ? `${asData("user-note", note, PROMPT_LIMITS.note)}\n` : ""}` +
      `Return the JSON object now.`,
    images,
    jsonSchema: FOOD_PROPOSAL_SCHEMA,
    temperature: 0,
    maxTokens: 4096,
  });
  return parseProposal(response.text);
}

export function parseProposal(raw: string): FoodProposal {
  let parsed: unknown;
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const candidates = [cleaned];
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) candidates.push(match[0]);
  // repair truncated output by closing open braces/brackets in order
  const stack: string[] = [];
  for (const ch of cleaned) {
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" && stack.length && stack[stack.length - 1] === "{") stack.pop();
    else if (ch === "]" && stack.length && stack[stack.length - 1] === "[") stack.pop();
  }
  let repaired = cleaned;
  while (stack.length) {
    const open = stack.pop()!;
    repaired += open === "{" ? "}" : "]";
  }
  candidates.push(repaired);

  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      parsed = undefined;
    }
  }
  if (!parsed) throw new Error("The model did not return JSON.");
  if (!parsed || typeof parsed !== "object") throw new Error("The model returned an empty answer.");
  const obj = parsed as Record<string, unknown>;

  const proposal: FoodProposal = { name: String(obj.name ?? "").trim() };
  if (!proposal.name) throw new Error("The model did not return a food name.");

  if (Array.isArray(obj.aliases)) proposal.aliases = obj.aliases.filter((v) => typeof v === "string") as string[];
  if (typeof obj.category === "string") proposal.category = obj.category;
  if (typeof obj.kind === "string") proposal.kind = obj.kind as FoodProposal["kind"];
  if (typeof obj.state === "string") proposal.state = obj.state as FoodProposal["state"];
  if (typeof obj.basis === "string") proposal.basis = obj.basis as FoodProposal["basis"];
  if (typeof obj.servingSizeG === "number" && Number.isFinite(obj.servingSizeG)) proposal.servingSizeG = obj.servingSizeG;
  if (typeof obj.servingsPerPack === "number" && Number.isFinite(obj.servingsPerPack)) proposal.servingsPerPack = obj.servingsPerPack;
  if (Array.isArray(obj.portions)) {
    proposal.portions = obj.portions
      .filter((p) => p && typeof p === "object")
      .map((p: any) => ({ label: String(p.label ?? ""), grams: Number(p.grams) }))
      .filter((p) => p.label && Number.isFinite(p.grams) && p.grams > 0);
  }
  if (obj.nutrients && typeof obj.nutrients === "object") {
    const nutrients: Partial<Record<NutrientCode, number>> = {};
    for (const code of NUTRIENT_CODES) {
      const v = (obj.nutrients as Record<string, unknown>)[code];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) nutrients[code] = v;
    }
    proposal.nutrients = nutrients;
  }
  if (Array.isArray(obj.estimated)) {
    proposal.estimated = obj.estimated.filter((v) => typeof v === "string" && (NUTRIENT_CODES as readonly string[]).includes(v)) as NutrientCode[];
  }
  if (typeof obj.rationale === "string") proposal.rationale = obj.rationale;

  return proposal;
}

/** Convert a proposal into the normalised input the DB layer expects. */
export function proposalToInput(proposal: FoodProposal): CapturedFoodInput {
  return {
    name: proposal.name,
    aliases: proposal.aliases ?? [],
    category: proposal.category,
    kind: proposal.kind ?? "branded",
    state: proposal.state ?? "raw",
    basis: proposal.basis,
    servingSizeG: proposal.servingSizeG,
    servingsPerPack: proposal.servingsPerPack,
    source: "llm",
    nutrients: proposal.nutrients,
    estimated: proposal.estimated,
    portions: proposal.portions,
  };
}
