import { complete, fallbackFor, getAiConfig, primaryFor } from "./client";
import { asData, withMaster, DATA_PREAMBLE, PROMPT_LIMITS } from "./prompt";
import type { ImagePart } from "./types";
import type { CapturedFoodInput, CapturedPortionInput } from "@/lib/captured-food";
import { NUTRIENT_CODES, NUTRIENTS, type NutrientCode } from "@/lib/nutrition/types";

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

const CODE_LIST = NUTRIENT_CODES.map(
  (code) => `${code} (${NUTRIENTS[code].unit})`,
).join(", ");

const SYSTEM = `You are a nutrition data extractor. You read a food description or a nutrition label and return one JSON object matching the schema. You never invent numbers.

Rules you must follow:
1. Return ONLY the JSON object. No markdown, no prose, no code fences.
2. Fill every field you can read. A dense panel is often two columns of text with small numbers — work line by line, one row at a time, and copy every printed row of the per-100 g column, including the small rows:
   - name: the common food name (e.g. "Paneer", "Whole milk").
   - category: one of Dairy, Grains, Vegetables, Fruits, Legumes, Oils, Nuts, Meat, Seafood, Spices, Beverages, or Custom.
   - kind: "branded" for packaged foods, "raw" for single ingredients, "composite" for mixed dishes, "provisional" only if you are guessing.
   - state: "raw" unless the food is cooked/ready to eat.
   - basis: "per_100g" for labels that say per 100 g; "per_serving" if the panel is per serving; "per_pack" if per pack.
   - servingSizeG: the serving weight in grams, when the label gives one.
   - aliases: common alternate names, local names, or synonyms (at least one if you know any).
   - portions: household measures with their gram weight (e.g. {"label":"1 katori","grams":100}).
   - nutrients: copy EVERY printed row of the per-100 g column, in the panel's order. Use EXACTLY these keys: ${CODE_LIST}.
     Values are bare numbers (no units, no text).
     A panel usually prints three columns: per 100 g, per serving, and %RDA. Use ONLY the per-100 g column when it exists; never use the serving or %RDA column as a value.
     If a value is printed with a "<" (e.g. "<2 g"), return the printed number and list that code in estimated[].
     Never write 0 for a nutrient the panel does not print — OMIT it. Only write a value for a number you can actually see.
     Sodium is in milligrams; do not convert it.
   - estimated: list the codes of any value you had to guess, compute or take as a bound.
   - rationale: one short sentence saying where the values came from.
3. If a nutrient is not printed, leave it out. Unknown is a valid answer. 0 is a made-up answer.
4. Do not round aggressively. Keep the label's precision.
5. Never include a food id, a database key, or any field outside the schema.
6. If the input is unusable, return {"name": ""} and nothing else.`;

/** A read with at least this many anchor nutrients counts as a human-usable answer. */
const STRONG_ENOUGH = 3;

/**
 * The extraction ladder, shared by text and images.
 *
 * A small primary model (e.g. flash-lite) reads dense panels badly. When its
 * answer lands below the anchor threshold, the configured fallback is asked
 * once, then the answer-so-far is fed back to a correction re-ask. At most
 * two calls beyond the base one, all logged and counted against the cap.
 * The first call wins when its read is strong; when everything fails, the
 * weak first answer (or nothing) survives — never a fabricated one.
 */
async function runLadder(input: {
  capability: "text" | "vision";
  images?: ImagePart[];
  source: "image" | "description";
  basePrompt: () => string;
}): Promise<FoodProposal> {
  const call = (preferFallback: boolean, prompt: string): Promise<FoodProposal> =>
    complete(
      {
        capability: input.capability,
        system: withMaster(SYSTEM),
        prompt,
        ...(input.images ? { images: input.images } : {}),
        jsonSchema: FOOD_PROPOSAL_SCHEMA,
        temperature: 0,
        maxTokens: 4096,
      },
      preferFallback ? { preferFallback: true } : undefined,
    ).then((response) => parseProposal(response.text));

  const first = await call(false, input.basePrompt());
  const firstQuality = anchorCount(first);
  if (firstQuality >= STRONG_ENOUGH) return first;

  // The primary model's read was weak — a human would call this an empty
  // answer. If a distinct fallback is configured, escalate to it once.
  // Without one this is a no-op and the first (weak) answer stands.
  let best = first;
  if (distinctFallback(input.capability)) {
    try {
      const second = await call(true, input.basePrompt());
      if (anchorCount(second) > firstQuality) best = second;
    } catch {
      /* the fallback is a bonus path; the weak first answer survives */
    }
  }

  const bestQuality = anchorCount(best);
  if (bestQuality >= STRONG_ENOUGH) return best;

  // Instructor-style correction: even when nutrients are present but few,
  // the answer misses printed values. Re-ask once, feeding the weak answer
  // back as the error report. Ask the stronger model to do the correcting.
  const retryPrompt =
    `${DATA_PREAMBLE}\n` +
    `Your previous answer is below. It misses printed nutrients (it may be missing most or all of the nutrients object).\n` +
    `${asData(
      "previous-answer",
      JSON.stringify(best).slice(0, 1_500),
      1_500,
    )}\n` +
    `Read the ${input.source} again and return the same record, this time with every printed nutrient copied from the per-100g column. ` +
    `Use exactly the codes listed in the schema; never write 0 for an unknown nutrient.\n` +
    `Return the JSON object now.`;
  let retry: FoodProposal | null = null;
  try {
    retry = await call(distinctFallback(input.capability), retryPrompt);
  } catch {
    retry = null;
  }
  if (!retry) return best;

  // A correction is only allowed to make the read strictly better: it must
  // carry at least one anchor and no fewer anchors than the answer it
  // replaces. This keeps a garbled retry from overwriting a real 2-of-6.
  const retryQuality = anchorCount(retry);
  if (retryQuality > 0 && retryQuality >= bestQuality) return retry;
  return best;
}

export async function extractFoodFromText(text: string): Promise<FoodProposal> {
  return runLadder({
    capability: "text",
    source: "description",
    basePrompt: () =>
      `${DATA_PREAMBLE}\n${asData("description", text, PROMPT_LIMITS.request)}\n\nReturn the JSON object now.`,
  });
}

/**
 * How many of the six macros the panel is guaranteed to print came back as
 * real numbers. Fewer than this means the model could not read the panel; a
 * human looking at the same input would call the answer empty.
 */
const ANCHOR_CODES: NutrientCode[] = ["ENERC_KCAL", "PROCNT", "CHOCDF", "FAT", "FIBTG", "NA"];

function anchorCount(proposal: FoodProposal): number {
  if (!proposal.nutrients) return 0;
  let count = 0;
  for (const code of ANCHOR_CODES) {
    const value = proposal.nutrients[code];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) count += 1;
  }
  return count;
}

/** The user's config points a distinct model at "fallback" when that exists. */
function distinctFallback(capability: "text" | "vision"): boolean {
  const config = getAiConfig();
  const primary = primaryFor(config, capability);
  const fallback = fallbackFor(config, capability);
  if (!fallback) return false;
  return fallback.provider !== primary.provider || fallback.model !== primary.model;
}

export async function extractFoodFromImage(
  images: ImagePart[],
  note?: string,
): Promise<FoodProposal> {
  return runLadder({
    capability: "vision",
    images,
    source: "image",
    basePrompt: () =>
      `Read the nutrition label in the image and extract a food record.\n` +
      `${DATA_PREAMBLE}\n` +
      `${note ? `${asData("user-note", note, PROMPT_LIMITS.note)}\n` : ""}` +
      `Return the JSON object now.`,
  });
}

/** Parse a number printed on a label: "387.44", "<2", "1.35 mg", "—". */
function labelNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const match = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** "Energy (kcal)", "ENERGY_KCAL" and "Total Sugars (g)" all meet in the middle. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map common spellings onto the canonical codes, in both directions. */
const ALIASES: Record<string, NutrientCode> = (() => {
  const aliases: Record<string, NutrientCode> = {};
  for (const code of NUTRIENT_CODES) {
    aliases[normaliseKey(code)] = code;
  }
  const extra: Record<string, NutrientCode> = {
    energy: "ENERC_KCAL",
    energies: "ENERC_KCAL",
    energykcal: "ENERC_KCAL",
    energykcalorie: "ENERC_KCAL",
    energykcalories: "ENERC_KCAL",
    calories: "ENERC_KCAL",
    caloriecontent: "ENERC_KCAL",
    protein: "PROCNT",
    proteins: "PROCNT",
    totalprotein: "PROCNT",
    fat: "FAT",
    fats: "FAT",
    totalfat: "FAT",
    totalfats: "FAT",
    carbohydrate: "CHOCDF",
    carbohydrates: "CHOCDF",
    totalcarbohydrate: "CHOCDF",
    totalcarbohydrates: "CHOCDF",
    carbs: "CHOCDF",
    totalcarbs: "CHOCDF",
    fibre: "FIBTG",
    fiber: "FIBTG",
    dietaryfibre: "FIBTG",
    dietaryfiber: "FIBTG",
    totalfibre: "FIBTG",
    totalfiber: "FIBTG",
    sugar: "SUGAR",
    sugars: "SUGAR",
    totalsugar: "SUGAR",
    totalsugars: "SUGAR",
    sodium: "NA",
    potassium: "K",
    calcium: "CA",
    iron: "FE",
    zinc: "ZN",
    magnesium: "MG",
    vitamina: "VITA_RAE",
    vitaminarae: "VITA_RAE",
    vitaminc: "VITC",
    vitamind: "VITD",
    vitaminb12: "VITB12",
    b12: "VITB12",
    cobalamin: "VITB12",
    folate: "FOL",
    folicacid: "FOL",
    vitaminb6: "VITB6",
    b6: "VITB6",
  };
  for (const [key, code] of Object.entries(extra)) {
    aliases[normaliseKey(key)] = code;
  }
  return aliases;
})();

function nutrientCode(key: string): NutrientCode | null {
  const normalized = normaliseKey(key);
  const direct = ALIASES[normalized];
  if (direct) return direct;
  // Keys with a unit glued on ("sodiummg", "energykj") still start with the word.
  let best: NutrientCode | null = null;
  for (const alias of Object.keys(ALIASES)) {
    if (alias.length >= 3 && normalized.startsWith(alias)) {
      if (!best || alias.length > normaliseKey(best).length) best = ALIASES[alias];
    }
  }
  return best;
}

function nutrientsFrom(raw: unknown): Partial<Record<NutrientCode, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const nutrients: Partial<Record<NutrientCode, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    const code = nutrientCode(key);
    if (!code) continue;
    const amount = labelNumber(value);
    if (amount === null) continue;
    nutrients[code] = amount;
  }
  return nutrients;
}

function estimatedCode(raw: unknown): NutrientCode | null {
  if (typeof raw !== "string") return null;
  return nutrientCode(raw);
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
  const serving = labelNumber(obj.servingSizeG);
  if (serving !== null) proposal.servingSizeG = serving;
  const servings = labelNumber(obj.servingsPerPack);
  if (servings !== null) proposal.servingsPerPack = servings;
  if (Array.isArray(obj.portions)) {
    proposal.portions = obj.portions
      .filter((p) => p && typeof p === "object")
      .map((p: any) => ({ label: String(p.label ?? ""), grams: Number(p.grams) }))
      .filter((p) => p.label && Number.isFinite(p.grams) && p.grams > 0);
  }
  // Models rarely answer exactly the envelope we ask for. Try the expected
  // object, then near-miss keys, then the top level itself.
  let nutrients = nutrientsFrom(obj.nutrients);
  if (Object.keys(nutrients).length === 0) {
    for (const key of [
      "nutrition",
      "nutritionFacts",
      "nutritionInfo",
      "nutritionPer100g",
      "nutrientsPer100g",
      "nutritionalValues",
      "nutritionalInformation",
    ]) {
      nutrients = nutrientsFrom(obj[key as keyof typeof obj]);
      if (Object.keys(nutrients).length > 0) break;
    }
  }
  if (Object.keys(nutrients).length === 0) nutrients = nutrientsFrom(obj);
  if (Object.keys(nutrients).length > 0) proposal.nutrients = nutrients;
  if (Array.isArray(obj.estimated)) {
    proposal.estimated = [
      ...new Set(
        obj.estimated
          .map(estimatedCode)
          .filter((code): code is NutrientCode => code !== null),
      ),
    ];
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
