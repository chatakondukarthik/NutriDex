import { complete } from "./client";
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

const SYSTEM = `You extract food and nutrition information into a strict JSON object.
Rules you must follow:
- Return ONLY the JSON object, no prose.
- Use the nutrient codes exactly as given. Amounts are per the declared basis, never invented.
- If a nutrient is not stated, omit it. Never write 0 for an unknown nutrient.
- If the basis is "per serving", include servingSizeG when you can read it.
- Portions are household measures with their gram weight when stated.
- "estimated" lists nutrient codes you had to guess or compute rather than read.
- Never include a food id, a database key, or any field outside the schema.`;

export async function extractFoodFromText(text: string): Promise<FoodProposal> {
  const response = await complete({
    capability: "text",
    system: SYSTEM,
    prompt: `Extract a food record from this description:\n\n${text}\n\nReturn JSON matching the schema.`,
    jsonSchema: FOOD_PROPOSAL_SCHEMA,
    temperature: 0,
  });
  return parseProposal(response.text);
}

export async function extractFoodFromImage(
  images: ImagePart[],
  note?: string,
): Promise<FoodProposal> {
  const response = await complete({
    capability: "vision",
    system: SYSTEM,
    prompt: `Extract a food record from the nutrition label / food photo provided.\n${note ? `User note: ${note}` : ""}\nReturn JSON matching the schema.`,
    images,
    jsonSchema: FOOD_PROPOSAL_SCHEMA,
    temperature: 0,
  });
  return parseProposal(response.text);
}

function parseProposal(raw: string): FoodProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // try to find a JSON object
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model did not return JSON.");
    parsed = JSON.parse(match[0]);
  }
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
