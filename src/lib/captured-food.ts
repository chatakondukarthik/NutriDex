import { NUTRIENT_CODES, type Food, type NutrientCode, type NutrientStatus } from "@/lib/nutrition/types";
import { MAX_GRAMS } from "@/lib/nutrition/units";

/**
 * Captured-food validation and normalisation.
 *
 * Separate from the database for the same reason `recipe-validate.ts` is:
 * the rules are the risky part, and they should be testable without a file.
 * Nothing here writes.
 */

export const CAPTURED_KINDS = ["provisional", "branded", "composite", "raw"] as const;
export type CapturedKind = (typeof CAPTURED_KINDS)[number];

export const CAPTURED_STATES = ["raw", "cooked"] as const;
export type CapturedState = (typeof CAPTURED_STATES)[number];

export const CAPTURED_BASES = ["per_100g", "per_serving", "per_pack"] as const;
export type CapturedBasis = (typeof CAPTURED_BASES)[number];

export interface CapturedPortionInput {
  label: string;
  grams: number;
  source?: string;
}

export interface CapturedFoodInput {
  name: string;
  aliases?: string[];
  category?: string;
  kind?: CapturedKind;
  state?: CapturedState;
  densityGPerMl?: number;
  basis?: CapturedBasis;
  servingSizeG?: number;
  servingsPerPack?: number;
  source?: string;
  sourceCode?: string;
  imagePath?: string;
  confidence?: number;
  /** Per 100 g. Omitted or null means unknown, never zero. */
  nutrients?: Partial<Record<NutrientCode, number | null>>;
  /** Which of the supplied nutrient values are estimates rather than facts. */
  estimated?: NutrientCode[];
  portions?: CapturedPortionInput[];
}

export interface PreparedPortion {
  label: string;
  grams: number;
  source: string | null;
}

export interface PreparedNutrient {
  nutrient: NutrientCode;
  amount: number | null;
  status: NutrientStatus;
}

export interface PreparedCapturedFood {
  name: string;
  aliases: string[];
  category: string;
  kind: CapturedKind;
  state: CapturedState;
  densityGPerMl: number | null;
  basis: CapturedBasis | null;
  servingSizeG: number | null;
  servingsPerPack: number | null;
  source: string;
  sourceCode: string | null;
  imagePath: string | null;
  confidence: number | null;
  nutrients: PreparedNutrient[];
  portions: PreparedPortion[];
}

export type PrepareCapturedResult =
  | { ok: true; food: PreparedCapturedFood }
  | { ok: false; message: string };

/** Energy cannot exceed pure fat: 9 kcal/g × 100 g. */
const MAX_ENERGY_PER_100G = 900;
/** Nothing in a nutrition panel exceeds a kilogram per 100 g. */
const MAX_PER_100G = 1_000_000;

function optionalPositive(
  value: number | undefined,
  label: string,
  max = Number.POSITIVE_INFINITY,
): string | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value <= 0) return `${label} must be a positive number.`;
  if (value > max) return `${label} is too large — check the value.`;
  return null;
}

export function prepareCapturedFood(input: CapturedFoodInput): PrepareCapturedResult {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the food a name." };
  if (name.length > 80) return { ok: false, message: "That name is too long." };

  const aliases = [...new Set((input.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))]
    .slice(0, 12);
  if (aliases.some((alias) => alias.length > 60)) {
    return { ok: false, message: "One of the alternate names is too long." };
  }

  const kind = input.kind ?? "provisional";
  if (!CAPTURED_KINDS.includes(kind)) {
    return { ok: false, message: "That food type is not supported." };
  }

  const state = input.state ?? "raw";
  if (!CAPTURED_STATES.includes(state)) {
    return { ok: false, message: "That preparation state is not supported." };
  }

  const basis = input.basis ?? null;
  if (basis && !CAPTURED_BASES.includes(basis)) {
    return { ok: false, message: "That nutrition basis is not supported." };
  }

  for (const [value, label, max] of [
    [input.densityGPerMl, "Density", 3],
    [input.servingSizeG, "Serving size", MAX_GRAMS],
    [input.servingsPerPack, "Servings per pack", 1000],
  ] as const) {
    const problem = optionalPositive(value, label, max);
    if (problem) return { ok: false, message: problem };
  }

  if (input.confidence != null) {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      return { ok: false, message: "Confidence must be between 0 and 1." };
    }
  }

  const portions = (input.portions ?? []).map((portion) => {
    const label = portion.label.trim();
    const source = portion.source?.trim() || null;
    return { label, grams: portion.grams, source };
  });

  if (portions.length > 20) {
    return { ok: false, message: "That is a lot of portions. Keep the useful ones." };
  }
  for (const portion of portions) {
    if (!portion.label) return { ok: false, message: "Every portion needs a name." };
    if (!Number.isFinite(portion.grams) || portion.grams <= 0) {
      return { ok: false, message: `The portion "${portion.label}" needs a weight.` };
    }
    if (portion.grams > MAX_GRAMS) {
      return { ok: false, message: `The portion "${portion.label}" is too large.` };
    }
  }

  const estimated = new Set(input.estimated ?? []);
  for (const code of estimated) {
    if (!NUTRIENT_CODES.includes(code)) {
      return { ok: false, message: "One of the estimated nutrients is not tracked." };
    }
  }

  const nutrients: PreparedNutrient[] = [];
  for (const code of NUTRIENT_CODES) {
    const raw = input.nutrients?.[code];
    if (raw == null) {
      nutrients.push({ nutrient: code, amount: null, status: "unknown" });
      continue;
    }
    if (!Number.isFinite(raw) || raw < 0) {
      return { ok: false, message: "Nutrient amounts must be zero or more." };
    }
    if (raw > MAX_PER_100G) {
      return { ok: false, message: "One of the nutrient amounts is too large." };
    }
    if (code === "ENERC_KCAL" && raw > MAX_ENERGY_PER_100G) {
      return {
        ok: false,
        message: "Energy cannot exceed 900 kcal per 100 g — check the units.",
      };
    }
    nutrients.push({
      nutrient: code,
      amount: raw,
      status: estimated.has(code) ? "estimated" : "known",
    });
  }

  return {
    ok: true,
    food: {
      name,
      aliases,
      category: input.category?.trim() || "Custom",
      kind,
      state,
      densityGPerMl: input.densityGPerMl ?? null,
      basis,
      servingSizeG: input.servingSizeG ?? null,
      servingsPerPack: input.servingsPerPack ?? null,
      source: input.source?.trim() || "manual",
      sourceCode: input.sourceCode?.trim() || null,
      imagePath: input.imagePath?.trim() || null,
      confidence: input.confidence ?? null,
      nutrients,
      portions,
    },
  };
}

/** Build the full `Food` shape, with every untracked nutrient explicitly unknown. */
export function capturedFoodToFood(
  row: PreparedCapturedFood & { id: string },
): Food {
  const nutrients = {} as Food["nutrients"];
  for (const code of NUTRIENT_CODES) {
    const prepared = row.nutrients.find((entry) => entry.nutrient === code);
    nutrients[code] = {
      amount: prepared?.amount ?? null,
      status: prepared?.status ?? "unknown",
      source: row.source,
      ...(row.sourceCode ? { sourceFoodCode: row.sourceCode } : {}),
    };
  }

  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    category: row.category,
    kind: row.kind,
    state: row.state,
    ...(row.densityGPerMl != null ? { densityGPerMl: row.densityGPerMl } : {}),
    portions: row.portions.map((portion) => ({
      label: portion.label,
      grams: portion.grams,
      source: portion.source ?? "user measure",
    })),
    nutrients,
    source: row.source,
    ...(row.sourceCode ? { sourceCode: row.sourceCode } : {}),
    ...(row.basis ? { basis: row.basis } : {}),
    ...(row.servingSizeG != null ? { servingSizeG: row.servingSizeG } : {}),
    ...(row.servingsPerPack != null ? { servingsPerPack: row.servingsPerPack } : {}),
    ...(row.imagePath ? { imagePath: row.imagePath } : {}),
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
  };
}
