"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { SparkleIcon } from "@/components/icons";
import { previewRecipeFromPromptAction, createRecipeFromPlanAction } from "@/app/actions";
import { ImageCapture, type CapturedImage } from "@/components/image-capture";
import type { RecipePlan } from "@/lib/ai-generate-recipe";
import type { PlanFoodResolution } from "@/lib/ai/food-resolve";
import type { Graph } from "@/lib/nutrition/graph";
import { NutrientPicker } from "@/components/nutrient-picker";
import { NUTRIENT_CODES, type NutrientCode } from "@/lib/nutrition/types";

/**
 * The AI recipe dialog — the review gate between a prompt and a saved recipe.
 *
 * It owns no button. The floating bar on the canvas (`AiCanvasBar`) is the
 * entry point: whatever it submits arrives here as `command`, the dialog
 * opens, the plan is requested, and nothing is materialized until the user
 * confirms — the same honest sequence the old two buttons used, behind one.
 *
 * Context rule: the caller serializes the *live canvas* — unsaved edits
 * included — and passes it as `canvas`. An empty canvas is a create prompt;
 * anything else is "modify this", exactly what you typed.
 */
interface RecipeGeneratorProps {
  aiEnabled: boolean;
  recipeId?: string | null;
  /** The version being edited (edit mode). */
  versionId?: string | null;
  versionNo?: number | null;
  /** Live canvas context — unsaved edits included. */
  canvas: {
    name: string;
    instructions: string;
    servings: string;
    graph: Graph;
  };
  /** The bar's latest submission; bump `seq` to auto-run. */
  command?: { seq: number; prompt: string } | null;
  /** Where the workspace decided the save should go; mirrors the top-bar chips. */
  saveMode?: "new-version" | "replace-current";
  /** How many plan/diary entries pin this version; shown in the confirm copy. */
  replacePinned?: number;
  /** The user confirmed replacement in the top-bar stern strip. */
  replaceArmed?: boolean;
}

export function RecipeGenerator({
  aiEnabled,
  recipeId = null,
  versionId = null,
  versionNo = null,
  canvas,
  command = null,
  saveMode: initialSaveMode = "new-version",
  replacePinned = 0,
}: RecipeGeneratorProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [plan, setPlan] = useState<RecipePlan | null>(null);
  const [resolutions, setResolutions] = useState<PlanFoodResolution[] | null>(null);
  // Fill the leftover nutrition of the ingredients with AI estimates after
  // the save (never blocks it). Known values are never touched; every fill
  // lands as estimated + ai:model with a reason attached.
  const [fillMissingNutrition, setFillMissingNutrition] = useState(true);
  // Which nutrients the post-save ingredient fill may estimate. Defaults to
  // everything — the checkbox alone means "all unknown nutrients" — but the
  // user can narrow it to exactly what they want.
  const [fillCodes, setFillCodes] = useState<Set<NutrientCode>>(() => new Set(NUTRIENT_CODES));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useDialogFocus(open, () => setOpen(false));

  const isEdit = !!recipeId || canvas.graph.nodes.length > 0;
  const existingName = canvas.name.trim() || "this recipe";
  const [saveMode, setSaveMode] = useState<"new-version" | "replace-current">(initialSaveMode);

  async function runGenerate(promptText: string, imgs: CapturedImage[]) {
    if (!promptText.trim() && imgs.length === 0) return;
    setError(null);
    setPlan(null);
    setResolutions(null);
    startTransition(async () => {
      const servings = Number(canvas.servings);
      const result = await previewRecipeFromPromptAction({
        prompt: promptText,
        recipeId: isEdit && canvas.graph.nodes.length === 0 ? recipeId : null,
        context:
          canvas.graph.nodes.length > 0
            ? {
                name: canvas.name.trim() || "Recipe",
                instructions: canvas.instructions,
                servings: Number.isFinite(servings) ? servings : 1,
                graph: canvas.graph,
              }
            : null,
        images: imgs.length ? imgs : undefined,
      });
      if (!result.ok || !result.plan) {
        setError(result.message ?? "Could not plan that recipe.");
        return;
      }
      setPlan(result.plan);
      setResolutions(result.resolutions ?? null);
    });
  }

  // The floating bar drove us here — open the dialog and ask for the plan.
  useEffect(() => {
    if (!command || !aiEnabled) return;
    setPrompt(command.prompt);
    setImages([]);
    setOpen(true);
    void runGenerate(command.prompt, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.seq]);

  const replacing = isEdit && saveMode === "replace-current" && versionId != null;
  const missingCount = resolutions?.filter((r) => r.status !== "reused").length ?? 0;
  const confirmLabel = !isEdit
    ? "Add recipe"
    : replacing
      ? `Replace v${versionNo ?? ""}`
      : "Save as new version";

  async function create() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const result = await createRecipeFromPlanAction({
        ...plan,
        recipeId: isEdit && recipeId ? recipeId : null,
        mode: isEdit ? saveMode : "new-version",
        replaceVersionId: replacing ? versionId : null,
        fillMissingNutrition,
        fillNutrientCodes: fillMissingNutrition ? [...fillCodes] : undefined,
      });
      if (!result.ok || !result.recipeId) {
        setError(result.message ?? "Could not create the recipe.");
        return;
      }
      router.push(`/recipes/${result.recipeId}`);
    });
  }

  if (!aiEnabled) {
    return null;
  }

  return (
    <>
      {open && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "Edit this recipe with AI" : "Create a recipe with AI"}
            tabIndex={-1}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-card outline-none"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{isEdit ? "Edit with AI" : "Create with AI"}</h2>
                <p className="mt-0.5 text-[11px] text-muted">
                  {isEdit
                    ? `Tell me what to change in “${existingName}” — or attach a photo of it. The AI re-proposes the full diagram; unknown foods are created automatically. Nothing is saved until you confirm.`
                    : "Describe any dish, or attach a photo of a recipe card, a dish or what you have. The AI proposes steps and inputs; unknown foods are created automatically. Nothing is saved until you confirm."}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink/40 hover:bg-ink/5">
                ✕
              </button>
            </div>

            {!plan ? (
              <>
                <textarea
                  autoFocus
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={isEdit ? "e.g. less oil; make it spicier; double the sprouts" : "e.g. palak sprouts bhurji, or use up this paneer &amp; tomatoes…"}
                  rows={3}
                  className="mt-3 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
                />
                <div className="mt-2">
                  <ImageCapture
                    label="Photos (optional)"
                    hint="A screenshot or photo of the recipe, the dish, or what you have. Up to 3."
                    disabled={pending}
                    onChange={setImages}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  {error && <p className="text-[11px] text-danger-ink">{error}</p>}
                  <button
                    type="button"
                    onClick={() => runGenerate(prompt, images)}
                    disabled={pending || (!prompt.trim() && images.length === 0)}
                    className="ml-auto rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
                  >
                    {pending ? "Planning…" : "Plan it"}
                  </button>
                </div>
              </>
            ) : (
              <>
                {isEdit && saveMode === "replace-current" && replacePinned > 0 && (
                  <p className="mt-3 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-[10px] leading-relaxed text-warn-ink">
                    v{versionNo ?? ""} is pinned by {replacePinned} plan or diary {replacePinned === 1 ? "entry" : "entries"} —
                    replacing rewrites them too. Otherwise the default is a new version.
                  </p>
                )}
                <div className="mt-3 rounded-xl border border-line bg-bg p-3">
                  <p className="text-sm font-semibold">{plan.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Serves {plan.servings} · {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}
                  </p>
                  <ol className="mt-2 space-y-1 text-xs leading-snug">
                    {plan.steps.map((step, index) => (
                      <li key={index} className="flex items-baseline gap-2">
                        <span className="tabular shrink-0 text-ink/35">{index + 1}.</span>
                        <span>
                          <span className="font-medium">{step.name}</span>
                          <span className="text-[10px] uppercase text-ink/40"> · {step.operation}</span>
                          {step.consumes && step.consumes.length > 0 && (
                            <span className="block pl-3 text-[10px] text-accent/80">
                              ↓ uses output of{" "}
                              {step.consumes
                                .map((d) => plan.steps[d]?.name ?? `step ${d + 1}`)
                                .join(" + ")}
                            </span>
                          )}
                          {step.note && (
                            <span className="block pl-3 text-[10px] italic text-ink/45">📝 {step.note}</span>
                          )}
                          {step.inputs.length > 0 && (
                            <span className="block pl-3 text-[10px] text-muted">
                              {step.inputs.map((input, inputIndex) => (
                                <span key={inputIndex} className="block">
                                  {input.foodName} {Math.round(input.grams)}g
                                  {input.note && <span className="italic text-ink/40"> — {input.note}</span>}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {plan.instructions && (
                    <p className="mt-2 border-t border-line/60 pt-2 text-[10px] leading-relaxed text-muted">
                      {plan.instructions}
                    </p>
                  )}
                </div>
                {resolutions && resolutions.length > 0 && (
                  <div className="mt-3">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink/35">
                      Where the ingredients come from
                    </h3>
                    <ul className="mt-1.5 max-h-44 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-bg">
                      {resolutions.map((resolution) => (
                        <li key={resolution.name} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5 text-[11px]">
                          <span className="min-w-0 truncate">{resolution.name}</span>
                          {resolution.status === "reused" && (
                            <span className="shrink-0 text-[10px] font-medium text-accent" title={resolution.matchedName ?? undefined}>
                              reusing {resolution.matchedName}
                            </span>
                          )}
                          {resolution.status === "usda-import" && (
                            <span className="shrink-0 text-[10px] font-medium text-ink/55" title={`FoodData Central #${resolution.fdcId}`}>
                              USDA import · {resolution.matchedName}
                            </span>
                          )}
                          {resolution.status === "provisional" && (
                            <span className="shrink-0 text-[10px] font-medium text-warn-ink">
                              provisional · all nutrients unknown
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[10px] text-ink/40">
                      Reused foods keep their real values. USDA imports are real values from FoodData Central.
                      Provisional foods stay unknown until you fill them in — the AI never invents them.
                    </p>
                  </div>
                )}
                {resolutions && resolutions.some((r) => r.status !== "reused") && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-[10px] leading-relaxed text-warn-ink">
                    <input
                      type="checkbox"
                      checked={fillMissingNutrition}
                      onChange={(event) => setFillMissingNutrition(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Fill the {missingCount} ingredient{missingCount === 1 ? "" : "s"} above with
                      AI estimates, right after the save — the recipe itself never waits on it.
                      They will land as <strong>estimated</strong> (marked, editable,
                      never overwriting known values) — every future recipe, plan and diary entry
                      that uses them reuses these estimates.
                    </span>
                  </label>
                )}
                {resolutions && resolutions.some((r) => r.status !== "reused") && fillMissingNutrition && (
                  <div className="mt-2 rounded-md border border-line bg-bg px-3 py-2">
                    <p className="text-[9px] font-medium uppercase tracking-wide text-ink/40">
                      Which nutrients should the AI estimate?
                    </p>
                    <div className="mt-1.5">
                      <NutrientPicker
                        options={NUTRIENT_CODES}
                        value={fillCodes}
                        onChange={setFillCodes}
                        idPrefix="recipe-fill"
                      />
                    </div>
                    <p className="mt-1.5 text-[9px] leading-snug text-ink/45">
                      {fillCodes.size === 0
                        ? "Nothing selected — the new ingredients will stay unknown until you fill them from Foods."
                        : "Only the selected nutrients are estimated on the new ingredients — known values are never touched."}
                    </p>
                  </div>
                )}
                {isEdit && versionNo != null && (
                  <div className="mt-3">
                    <div
                      role="group"
                      aria-label="Where to save"
                      className="flex h-8 w-fit items-center gap-0.5 rounded-lg bg-ink/[0.06] p-0.5 text-[11px]"
                    >
                      <button
                        type="button"
                        onClick={() => setSaveMode("new-version")}
                        aria-pressed={saveMode === "new-version"}
                        className={`rounded-md px-3 py-1.5 font-medium transition ${
                          saveMode === "new-version" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                        }`}
                      >
                        New version
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaveMode("replace-current")}
                        aria-pressed={saveMode === "replace-current"}
                        className={`rounded-md px-3 py-1.5 font-medium transition ${
                          saveMode === "replace-current" ? "bg-surface text-danger-ink shadow-sm" : "text-muted hover:text-ink"
                        }`}
                      >
                        Replace v{versionNo}
                      </button>
                    </div>
                    <p className={`mt-2 rounded-md border px-3 py-2 text-[10px] leading-relaxed ${
                      replacing ? "border-warn-line bg-warn-soft text-warn-ink" : "border-line bg-bg text-muted"
                    }`}>
                      {replacing
                        ? `Will replace v${versionNo} in place — plans and diary entries pinned to it will see the new values.`
                        : `Will be saved as v${versionNo + 1} — v${versionNo} stays untouched.`}
                      {replacePinned > 0 && saveMode === "replace-current" && (
                        <span className="mt-1 block font-semibold">
                          {replacePinned} plan or diary {replacePinned === 1 ? "entry" : "entries"} pinned to v{versionNo} will see the new values.
                        </span>
                      )}
                    </p>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button type="button" onClick={() => { setPlan(null); setResolutions(null); }} className="text-[11px] font-medium text-muted hover:text-ink">
                    ← Back to prompt
                  </button>
                  <button
                    type="button"
                    onClick={create}
                    disabled={pending}
                    className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
                  >
                    {pending ? "Saving…" : confirmLabel}
                  </button>
                </div>
                {error && <p className="mt-2 text-[11px] text-danger-ink">{error}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
