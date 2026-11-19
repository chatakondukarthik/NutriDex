/**
 * One word per provenance, used by every surface that names where a
 * value came from. Sources are recorded on the row (`source`/`source_kind`
 * on captured foods, `label` on recipe versions) so the UI never has to
 * guess from heuristics.
 *
 * The labels are short on purpose — a badge, not a sentence. Hover for the
 * sentence.
 */

export type ProvenanceTone = "accent" | "warn" | "faint" | "muted";

export interface Provenance {
  /** Short chip text, e.g. "USDA · SR Legacy". */
  short: string;
  /** Full sentence for tooltips, e.g. "Measured and published by USDA (SR Legacy, 2019)." */
  title: string;
  tone: ProvenanceTone;
}

const PROVENANCE: Record<string, Provenance> = {
  seed: { short: "Built-in", title: "Built into the app — the reference dataset.", tone: "faint" },
  manual: { short: "Manual", title: "Typed in by this household — not from any source.", tone: "muted" },
  llm: { short: "Filled by AI", title: "Values proposed by AI from a description or photo.", tone: "warn" },
  indb: { short: "INDB · measured", title: "From the Indian Nutrient Databank (IFCT 2017).", tone: "accent" },
  off: { short: "Barcode · Open Food Facts", title: "From an Open Food Facts barcode lookup.", tone: "muted" },
  usda: { short: "USDA", title: "USDA FoodData Central.", tone: "muted" },
  branded: { short: "USDA · Branded", title: "Manufacturer-submitted label values (USDA Branded).", tone: "muted" },
  foundation: { short: "USDA · Foundation", title: "Research-grade analytical values (USDA Foundation Foods).", tone: "accent" },
  sr_legacy: { short: "USDA · SR Legacy", title: "USDA SR Legacy reference table (2019).", tone: "accent" },
  fndds: { short: "USDA · Survey (FNDDS)", title: "USDA What We Eat in America — average of recipes.", tone: "accent" },
  openfoodfacts: { short: "Open Food Facts", title: "From Open Food Facts.", tone: "muted" },
};

const UNKNOWN: Provenance = {
  short: "Unrecorded",
  title: "The source was not recorded for this row.",
  tone: "faint",
};

/** Recipe version labels use the same helper with different words. */
const RECIPE: Record<string, Provenance> = {
  ai: { short: "AI-designed", title: "Created by the AI from a prompt.", tone: "warn" },
  authored: { short: "Authored", title: "Created by this household.", tone: "muted" },
  manual: { short: "Authored", title: "Created by this household.", tone: "muted" },
  preset: { short: "From preset", title: "Started from an app preset, then edited.", tone: "faint" },
  legacy: { short: "Legacy", title: "Converted from the old format — review the measurement math.", tone: "warn" },
  promoted: { short: "From food", title: "Promoted from a single food entry.", tone: "accent" },
};

function resolve(map: Record<string, Provenance>, key: string | null | undefined): Provenance {
  if (!key) return UNKNOWN;
  const hit = map[key];
  if (hit) return hit;
  return { short: key, title: `Source: ${key}`, tone: "muted" };
}

export function foodProvenance(
  source: string | null | undefined,
  sourceKind?: string | null,
): Provenance {
  const kind = sourceKind?.trim().toLowerCase();
  if (kind && kind !== "unknown") return resolve(PROVENANCE, kind);
  const src = source?.trim().toLowerCase();
  if (src) return resolve(PROVENANCE, src);
  // No source recorded at all: one of the built-in seed foods.
  return resolve(PROVENANCE, "seed");
}

const AUTHORED: Provenance = {
  short: "Authored",
  title: "Created by this household.",
  tone: "muted",
};

export function recipeProvenance(label: string | null | undefined): Provenance {
  const key = label?.trim().toLowerCase();
  if (!key) return AUTHORED;
  return resolve(RECIPE, key);
}

/** The household's origin bucket for filtering. */
export type FoodOrigin = "seed" | "usda" | "indb" | "off" | "llm" | "manual";

/**
 * Origin of a food, for filtering. AI evidence wins over the named source —
 * a USDA-lookup food whose nutrients were proposed by AI shows up under
 * AI-filled, which is the honest answer to "who built this?".
 */
export function foodOrigin(food: {
  source?: string | null;
  sourceKind?: string | null;
  nutrients?: Record<string, { method?: string | null } | undefined>;
}): FoodOrigin {
  const kind = food.sourceKind?.trim().toLowerCase();
  const ai = Object.values(food.nutrients ?? {}).some((value) =>
    (value?.method ?? "").toLowerCase().startsWith("ai:"),
  );
  if (kind === "llm" || ai) return "llm";
  if (kind === "indb") return "indb";
  if (kind === "off" || kind === "openfoodfacts") return "off";
  if (kind && ["usda", "branded", "foundation", "sr_legacy", "fndds"].includes(kind)) return "usda";
  const source = food.source?.trim().toLowerCase();
  if (!source) return "seed";
  if (["usda", "branded", "foundation", "sr_legacy", "fndds"].includes(source)) return "usda";
  if (source === "indb") return "indb";
  if (source === "openfoodfacts" || source === "off") return "off";
  return "manual";
}

/** The household's authoring bucket for filtering recipes. */
export type RecipeOrigin = "authored" | "ai" | "preset" | "promoted" | "legacy";

/** Recipe origin from the version label. Missing label = authored. */
export function recipeOrigin(label: string | null | undefined): RecipeOrigin {
  const key = label?.trim().toLowerCase();
  if (key === "ai") return "ai";
  if (key === "preset") return "preset";
  if (key === "promoted") return "promoted";
  if (key === "legacy") return "legacy";
  return "authored";
}
