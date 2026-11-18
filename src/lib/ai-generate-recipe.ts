/**
 * Build a recipe graph from a free-text prompt. Two phases so the user
 * always sees what will be created before anything is saved:
 *
 *   planRecipeFromPrompt(prompt) -> RecipePlan   (LLM, read-only)
 *   materializeRecipe(plan, note?) -> recipeId   (creates foods, writes graph)
 *
 * The model proposes the *structure*; nothing here trusts a number it cannot
 * back. Unknown foods are created as provisional (all-unknown nutrition) and
 * are fully editable afterwards.
 */

import { complete } from "@/lib/ai/client";
import { getAiConfig } from "@/lib/ai/client";
import { hasKey } from "@/lib/ai/secrets";
import { isAiEnabled } from "@/lib/ai/client";
import { listFoods } from "@/lib/db/foods";
import { resolvePlanFoods } from "@/lib/ai/food-resolve";
import { saveGraphDraft } from "@/lib/recipes-v2";
import { getRecipe, getVersion } from "@/lib/db/recipes";
import { cleanNote } from "@/lib/notes";
import { layoutGraph } from "@/lib/graph-layout";
import { asData, withMaster, DATA_PREAMBLE, PROMPT_LIMITS } from "@/lib/ai/prompt";
import type { Graph } from "@/lib/nutrition/graph";
import type { ImagePart } from "@/lib/ai/types";

export interface RecipePlanStepInput {
  foodName: string;
  grams: number;
  preparation?: string;
  /** Optional prep/handling hint for this ingredient (not a step). */
  note?: string;
}

export interface RecipePlanStep {
  name: string;
  operation: string;
  inputs: RecipePlanStepInput[];
  /**
   * Indices of earlier steps whose output this step consumes. [] means the
   * step starts fresh (its inputs are just the listed foods); omitted on
   * legacy plans, which fall back to a plain chain.
   */
  consumes?: number[];
  /** Optional technique/consistency/doneness hint — not a step of its own. */
  note?: string;
}

export interface RecipePlan {
  name: string;
  servings: number;
  instructions: string;
  steps: RecipePlanStep[];
}

export interface ExistingRecipeContext {
  name: string;
  servings: number;
  instructions: string;
  /** Plain-JSON copy of the current graph (nodes + edges). */
  graph: unknown;
}

/**
 * Bounds every plan must satisfy, wherever it came from.
 *
 * Two callers feed `materializeRecipe`: the model (after `JSON.parse`, which
 * used to be followed only by a `steps.length` check) and
 * `createRecipeFromPlanAction`, which accepted a plan straight from the
 * client. An unvalidated `operation` landed in the graph as an arbitrary
 * string, and a non-numeric `grams` became `NaN` via `Math.max(1, NaN)`.
 */
const OPERATIONS = new Set([
  "assemble", "mix", "boil", "pressure-cook", "steam", "sauté", "fry",
  "deep-fry", "roast", "bake", "grill", "blend", "strain", "reduce",
  "cool", "refrigerate", "freeze", "marinate", "ferment", "wash", "soak",
  "grate", "dice", "slice", "chop",
]);

const MAX_PLAN_STEPS = 30;
const MAX_PLAN_INPUTS = 60;
/** Across the whole plan: each unique name can cost a USDA search. */
const MAX_UNIQUE_INGREDIENTS = 60;
/** Mirrors the recipe validator's servings ceiling. */
const MAX_PLAN_SERVINGS = 100;
const MAX_GRAMS_PER_INPUT = 100_000;
const MAX_PLAN_NAME = 200;
const MAX_STEP_NAME = 120;
const MAX_FOOD_NAME = 200;
const MAX_PLAN_INSTRUCTIONS = 20_000;

export function validateRecipePlan(
  raw: unknown,
): { ok: true; plan: RecipePlan } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "The recipe plan was not a valid object." };
  }
  const plan = raw as Partial<RecipePlan>;

  if (typeof plan.name !== "string" || !plan.name.trim()) {
    return { ok: false, message: "The plan needs a recipe name." };
  }
  if (plan.name.length > MAX_PLAN_NAME) {
    return { ok: false, message: "That recipe name is too long." };
  }
  const servings = Number(plan.servings);
  if (!Number.isFinite(servings) || servings <= 0 || servings > MAX_PLAN_SERVINGS) {
    return { ok: false, message: `Servings must be between 1 and ${MAX_PLAN_SERVINGS}.` };
  }
  if (plan.instructions !== undefined && typeof plan.instructions !== "string") {
    return { ok: false, message: "The plan's instructions were malformed." };
  }
  if (typeof plan.instructions === "string" && plan.instructions.length > MAX_PLAN_INSTRUCTIONS) {
    return { ok: false, message: "The plan's instructions are too long." };
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { ok: false, message: "The plan did not contain any steps." };
  }
  if (plan.steps.length > MAX_PLAN_STEPS) {
    return { ok: false, message: `That plan has too many steps (limit ${MAX_PLAN_STEPS}).` };
  }

  const uniqueIngredients = new Set<string>();

  for (const [index, step] of plan.steps.entries()) {
    if (!step || typeof step !== "object") {
      return { ok: false, message: `Step ${index + 1} was malformed.` };
    }
    if (typeof step.name !== "string" || !step.name.trim()) {
      return { ok: false, message: `Step ${index + 1} needs a name.` };
    }
    if (step.name.length > MAX_STEP_NAME) {
      return { ok: false, message: `Step ${index + 1} has too long a name.` };
    }
    if (typeof step.operation !== "string" || !OPERATIONS.has(step.operation)) {
      return { ok: false, message: `Step ${index + 1} uses an unknown operation.` };
    }
    if (!Array.isArray(step.inputs) || step.inputs.length > MAX_PLAN_INPUTS) {
      return { ok: false, message: `Step ${index + 1} has too many ingredients.` };
    }
    for (const input of step.inputs) {
      if (!input || typeof input !== "object") {
        return { ok: false, message: `An ingredient in step ${index + 1} was malformed.` };
      }
      if (typeof input.foodName !== "string" || !input.foodName.trim()) {
        return { ok: false, message: `An ingredient in step ${index + 1} has no name.` };
      }
      if (input.foodName.length > MAX_FOOD_NAME) {
        return { ok: false, message: `An ingredient name in step ${index + 1} is too long.` };
      }
      uniqueIngredients.add(input.foodName.trim().toLowerCase());
      const grams = Number(input.grams);
      if (!Number.isFinite(grams) || grams <= 0 || grams > MAX_GRAMS_PER_INPUT) {
        return {
          ok: false,
          message: `"${input.foodName.trim().slice(0, 40)}" needs a positive weight.`,
        };
      }
    }
    if (step.consumes !== undefined) {
      if (!Array.isArray(step.consumes)) {
        return { ok: false, message: `Step ${index + 1} declares its dependencies malformedly.` };
      }
      // Impossible indices (forward, self, fractional, negative) are DROPPED,
      // not rejected — materializeRecipe has always filtered them so the
      // graph stays acyclic by construction, and the editor relies on that.
      // Normalising here means the client-fabricated path gets the same
      // guarantee the model path already had.
      step.consumes = step.consumes.filter(
        (d): d is number => Number.isInteger(d) && d >= 0 && d < index,
      );
    }
  }

  if (uniqueIngredients.size > MAX_UNIQUE_INGREDIENTS) {
    return {
      ok: false,
      message: `That plan has too many different ingredients (limit ${MAX_UNIQUE_INGREDIENTS}).`,
    };
  }

  return {
    ok: true,
    plan: {
      name: plan.name.trim(),
      servings,
      instructions: typeof plan.instructions === "string" ? plan.instructions : "",
      steps: plan.steps,
    },
  };
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    servings: { type: "number" },
    instructions: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Imperative step name, e.g. 'Sauté aromatics'" },
          operation: {
            type: "string",
            enum: [
              "assemble", "mix", "boil", "pressure-cook", "steam", "sauté", "fry",
              "deep-fry", "roast", "bake", "grill", "blend", "strain", "reduce",
              "cool", "refrigerate", "freeze", "marinate", "ferment", "wash", "soak",
              "grate", "dice", "slice", "chop",
            ],
          },
          inputs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                foodName: { type: "string" },
                grams: { type: "number" },
                preparation: { type: "string" },
                note: {
                  type: "string",
                  description:
                    "Optional prep/handling note for this ingredient (e.g. 'pat dry', 'slice 1 cm thick'). Omit when there is nothing useful.",
                },
              },
              required: ["foodName", "grams"],
            },
          },
          consumes: {
            type: "array",
            items: { type: "number" },
            description:
              "0-based indices of earlier steps whose OUTPUT this step uses (e.g. the sauce step's output into the assembly step). Empty if this step uses no upstream output.",
          },
          note: {
            type: "string",
            description:
              "Optional technique/consistency/doneness hint for this step (e.g. 'Whip until the batter falls in a ribbon.'). Omit when there is nothing useful.",
          },
        },
        required: ["name", "operation", "inputs", "consumes"],
      },
    },
  },
  required: ["name", "servings", "steps"],
} as const;

const SYSTEM = `You are a recipe architect for Indian home cooking.
Return ONLY a JSON object matching the schema. Rules:
- Decompose the dish into preparation steps (3–7 steps for most dishes), in a natural work order.
- Each step takes the quantities of its inputs in grams.
- Only include food inputs added IN that step — do not repeat an upstream step's ingredients in later steps unless they are added again.
- Declare real dependencies with "consumes": the 0-based indices of earlier steps whose OUTPUT this step uses. Example: ["Assemble wraps"] consumes the pan-fry step AND the garlic-sauce step; the sauce step itself consumes nothing ([]) and runs independently of the marinade. A step with consumes: [] starts fresh from its own listed inputs — list everything it needs.
- Do NOT chain steps just because they appear in order: only set consumes when the earlier step's output is genuinely an ingredient of the later step (a sauce, a cooked component, a strained liquid).
- Every step and every ingredient may carry one optional "note": a single sentence (≤ 200 characters) of technique, consistency, doneness or sensory guidance that is NOT a step of its own. Good: "Whip until the batter falls in a ribbon." / "Do not let the garlic brown — it turns bitter." / "Marinate at least 30 minutes." / "Pat dry so it sears, not steams." Bad: restating the step name, listing ingredients, or hiding a quantity or a food-safety step. Omit the note when there is nothing genuinely useful.
- When editing an existing recipe, keep its existing notes for steps and ingredients that stay unchanged; only change a note when the step itself changed.
- If the prompt is vague, keep quantities modest (serves ~2) and say so in instructions.
- Never invent nutrient values; you are not asked for them.
- Use common Indian ingredient names.`;

/**
 * Untrusted text goes into the prompt wrapped in explicit delimiters with
 * a "treat as data" preface. Recipe names, instructions and any pasted
 * text are second-order input — a stored name can carry instructions that
 * would otherwise read as system rules (BYO_LLM §9: injection is treated
 * as data corruption, so the framing has to be unambiguous).
 */
const MAX_PROMPT_CHARS = PROMPT_LIMITS.request;

export async function planRecipeFromPrompt(
  prompt: string,
  existing?: ExistingRecipeContext,
  images?: ImagePart[],
): Promise<RecipePlan> {
  const cleanPrompt = String(prompt ?? "").trim();
  const hasImages = Array.isArray(images) && images.length > 0;
  if (!cleanPrompt && !hasImages) {
    throw new Error("Ask me something first — a dish, a mood, a fridge list.");
  }
  if (cleanPrompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Keep the request under ${MAX_PROMPT_CHARS.toLocaleString()} characters.`);
  }

  const config = getAiConfig();
  if (!isAiEnabled()) throw new Error("AI is turned off in Settings.");
  if (!hasKey(config.provider)) throw new Error("No AI key configured. Add one in Settings.");

  const existingSection = existing
    ? `\nExisting recipe (modify this, do not start over):\n${asData(
        "existing-recipe",
        `Name: ${existing.name}\nServings: ${existing.servings}\nInstructions: ${existing.instructions}\nGraph (nodes and edges):\n${JSON.stringify(existing.graph)}`,
        PROMPT_LIMITS.request * 1.5,
      )}\nApply the user's request to this recipe.`
    : "";

  const { getMasterPrompt } = await import("@/lib/db/settings");
  // One home for the master prompt: the end of the system turn, as a
  // delimited block — the same place it goes in every other call.
  const system = withMaster(SYSTEM, getMasterPrompt());

  const response = await complete({
    // A photo changes what the model can see; route it as vision.
    capability: hasImages ? "vision" : "text",
    system,
    prompt: hasImages
      ? `${DATA_PREAMBLE}\n${
          cleanPrompt
            ? asData("request", cleanPrompt, PROMPT_LIMITS.request)
            : asData(
                "request",
                "Read the recipe in the attached photo and plan it. Transcribe it faithfully, then adjust only what the user asked for.",
                PROMPT_LIMITS.request,
              )
        }${existingSection}`
      : `${DATA_PREAMBLE}\n${asData("request", cleanPrompt, PROMPT_LIMITS.request)}${existingSection}`,
    images: hasImages ? images : undefined,
    jsonSchema: PLAN_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0,
    // Notes add output tokens; leave headroom so a 7-step plan never truncates.
    maxTokens: 3072,
  });

  const raw = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The model did not return a recipe plan.");
  }
  const valid = validateRecipePlan(parsed);
  if (!valid.ok) throw new Error(valid.message);
  return valid.plan;
}

/** Case/whitespace-insensitive key used to match steps and ingredients. */
function noteKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

interface PreservedNotes {
  steps: Map<string, string>;
  ingredients: Map<string, string>;
}

/**
 * Notes a human wrote on the current version, keyed so a regenerated plan
 * can carry them forward even when the model omits them. Best-effort only:
 * any failure means "no preservation", never a failed save.
 */
function loadPreservedNotes(recipeId?: string): PreservedNotes {
  const preserved: PreservedNotes = { steps: new Map(), ingredients: new Map() };
  if (!recipeId) return preserved;
  try {
    const recipe = getRecipe(recipeId);
    const versionId = recipe?.summary.currentVersionId;
    if (!versionId) return preserved;
    const version = getVersion(versionId);
    const graph = (version?.snapshot as { graph?: Graph } | undefined)?.graph;
    if (!graph) return preserved;

    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const node of graph.nodes) {
      const note = cleanNote((node as { note?: unknown }).note);
      if (note && node.type === "process") {
        const key = noteKey(node.name);
        if (key && !preserved.steps.has(key)) preserved.steps.set(key, note);
      }
    }
    for (const edge of graph.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (from?.type !== "food" || to?.type !== "process") continue;
      const note = cleanNote(from.note);
      if (!note) continue;
      const key = `${noteKey(to.name)}::${from.foodId}`;
      if (!preserved.ingredients.has(key)) preserved.ingredients.set(key, note);
    }
  } catch {
    // Losing preservation is acceptable; losing the save is not.
  }
  return preserved;
}

export async function materializeRecipe(
  plan: RecipePlan,
  recipeId?: string,
  opts?: {
    mode?: "new-version" | "replace-current";
    replaceVersionId?: string | null;
  },
): Promise<{
  recipeId: string;
  resolutions: import("@/lib/ai/food-resolve").PlanFoodResolution[];
  /**
   * Resolved food ids that still have unknown nutrients. The caller fills
   * them AFTER the response (see createRecipeFromPlanAction) — saving the
   * recipe itself never waits on the LLM.
   */
  fillTargets: string[];
}> {
  // Re-validated here regardless of caller: this is the function that
  // writes the graph, so the plan that reaches it must be well-formed
  // even when it did not come from `planRecipeFromPrompt`.
  const valid = validateRecipePlan(plan);
  if (!valid.ok) throw new Error(valid.message);
  plan = valid.plan;

  const { map: foodIndex, resolutions } = await resolvePlanFoods(plan, listFoods(), { persist: true });

  // Best-effort: carry notes written by hand on the current version into the
  // regenerated plan when the model did not restate them.
  const preserved = loadPreservedNotes(recipeId);

  const idBase = `gen-${Date.now().toString(36)}`;
  const nodes: Graph["nodes"] = [];
  const edges: Graph["edges"] = [];

  let prevProcessId: string | null = null;
  const processIds: string[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const stepKey = noteKey(step.name);
    const processId = `${idBase}-p${i}`;
    processIds.push(processId);
    nodes.push({
      id: processId,
      type: "process",
      operation: step.operation,
      name: step.name,
      outputs: [{ label: step.name, tag: "consumed", split: {} }],
      measuredOutputs: [null],
      factorEstimates: {},
      factorOverrides: {},
      note: cleanNote(step.note) ?? preserved.steps.get(stepKey) ?? null,
    });

    for (const input of step.inputs) {
      const foodId = foodIndex.get(input.foodName.trim().toLowerCase());
      if (!foodId) continue;
      const inputNodeId = `${idBase}-i${i}-${foodId.slice(0, 8)}`;
      // Defensive: validation already rejects non-finite weights, but a
      // `NaN` here would silently roll up as NaN nutrition downstream.
      const grams = Number.isFinite(input.grams) ? Math.max(1, input.grams) : 100;
      nodes.push({
        id: inputNodeId,
        type: "food",
        foodId,
        grams,
        note: cleanNote(input.note) ?? preserved.ingredients.get(`${stepKey}::${foodId}`) ?? null,
      });
      edges.push({
        id: `${inputNodeId}-${processId}`,
        from: inputNodeId,
        to: processId,
      });
    }

    // Real dependencies: which earlier steps' outputs this step uses.
    // Only strictly-earlier indices are honoured, so the graph is acyclic
    // by construction (the engine rejects cycles loudly anyway). A plan
    // without `consumes` (legacy) keeps the old straight chain.
    const deps = Array.isArray(step.consumes)
      ? step.consumes.filter((d) => Number.isInteger(d) && d >= 0 && d < i)
      : prevProcessId
        ? [i - 1]
        : [];
    for (const d of [...new Set(deps)]) {
      edges.push({ id: `${processIds[d]}-${processId}`, from: processIds[d], to: processId });
    }
    prevProcessId = processId;
  }

  // The same dagre layout the editor's Auto-layout button uses, so a recipe
  // born here opens already arranged instead of in a naive two-column pile.
  const layout = layoutGraph(
    nodes.map((node) => ({ id: node.id, type: node.type, note: node.note })),
    edges.map((edge) => ({ from: edge.from, to: edge.to })),
  );

  const saved = saveGraphDraft({
    recipeId: recipeId ?? null,
    name: plan.name,
    instructions: plan.instructions,
    servings: plan.servings,
    versionLabel: "AI",
    layout,
    graph: { nodes, edges },
    mode: opts?.mode,
    replaceVersionId: opts?.replaceVersionId ?? null,
  });

  if (!saved.ok || !saved.recipeId) {
    throw new Error(saved.message ?? "Could not save the generated recipe.");
  }
  const fillTargets = [...new Set([...foodIndex.values()].filter(Boolean))] as string[];
  return { recipeId: saved.recipeId, resolutions, fillTargets };
}
