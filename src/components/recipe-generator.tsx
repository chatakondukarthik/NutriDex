"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewRecipeFromPromptAction, createRecipeFromPlanAction } from "@/app/actions";
import type { RecipePlan } from "@/lib/ai-generate-recipe";

interface RecipeGeneratorProps {
  aiEnabled: boolean;
  mode?: "create" | "edit";
  recipeId?: string | null;
  /** The version being edited (edit mode). */
  versionId?: string | null;
  versionNo?: number | null;
  existingName?: string | null;
  /** Where the workspace decided the save should go; mirrors the top-bar chips. */
  saveMode?: "new-version" | "replace-current";
  replaceBlockedReason?: string | null;
}

export function RecipeGenerator({
  aiEnabled,
  mode = "create",
  recipeId = null,
  versionId = null,
  versionNo = null,
  existingName = null,
  saveMode = "new-version",
  replaceBlockedReason = null,
}: RecipeGeneratorProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<RecipePlan | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!aiEnabled) {
    return (
      <button
        type="button"
        disabled
        title="AI is off. Turn it on in Settings."
        className="cursor-not-allowed rounded-lg border border-line bg-bg px-3 py-1.5 text-xs font-semibold text-muted opacity-60"
      >
        {mode === "edit" ? "Edit with AI" : "Create with AI"} (off)
      </button>
    );
  }

  async function generate() {
    if (!prompt.trim()) return;
    setError(null);
    setPlan(null);
    startTransition(async () => {
      const result = await previewRecipeFromPromptAction({ prompt, recipeId: mode === "edit" ? recipeId : null });
      if (!result.ok || !result.plan) {
        setError(result.message ?? "Could not plan that recipe.");
        return;
      }
      setPlan(result.plan);
    });
  }

  const replacing = mode === "edit" && saveMode === "replace-current" && versionId != null;
  const confirmLabel =
    mode === "create"
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
        recipeId: mode === "edit" ? recipeId : null,
        mode: mode === "edit" ? saveMode : "new-version",
        replaceVersionId: replacing ? versionId : null,
      });
      if (!result.ok || !result.recipeId) {
        setError(result.message ?? "Could not create the recipe.");
        return;
      }
      router.push(`/recipes/${result.recipeId}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10"
      >
        {mode === "edit" ? "✨ Edit with AI" : "✨ Create with AI"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create a recipe with AI"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{mode === "edit" ? "Edit with AI" : "Create with AI"}</h2>
                <p className="mt-0.5 text-[11px] text-muted">
                  {mode === "edit"
                    ? `Tell me what to change in “${existingName ?? "this recipe"}”. The AI re-proposes the full diagram; unknown foods are created automatically. Nothing is saved until you confirm.`
                    : "Describe any dish. The AI proposes steps and inputs; unknown foods are created automatically. Nothing is saved until you confirm."}
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
                  placeholder={mode === "edit" ? "e.g. less oil; make it spicier; double the sprouts" : "e.g. palak sprouts bhurji, or use up this paneer &amp; tomatoes…"}
                  rows={3}
                  className="mt-3 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  {error && <p className="text-[11px] text-danger-ink">{error}</p>}
                  <button
                    type="button"
                    onClick={generate}
                    disabled={pending || !prompt.trim()}
                    className="ml-auto rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
                  >
                    {pending ? "Planning…" : "Plan it"}
                  </button>
                </div>
              </>
            ) : (
              <>
                {mode === "edit" && replaceBlockedReason && (
                  <p className="mt-3 rounded-md border border-line bg-bg px-3 py-2 text-[10px] text-muted">
                    Replace is unavailable: {replaceBlockedReason}
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
                          {step.inputs.length > 0 && (
                            <span className="block pl-3 text-[10px] text-muted">
                              {step.inputs.map((input) => `${input.foodName} ${Math.round(input.grams)}g`).join(" · ")}
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
                {mode === "edit" && (
                  <p
                    className={`mt-3 rounded-md border px-3 py-2 text-[10px] leading-relaxed ${
                      replacing
                        ? "border-warn-line bg-warn-soft text-warn-ink"
                        : "border-line bg-bg text-muted"
                    }`}
                  >
                    {replacing
                      ? `Will replace v${versionNo ?? ""} in place — plans and diary entries pinned to it will see the new values. Change the top-bar chips to save as a new version instead.`
                      : `Will be saved as a new version — v${versionNo ?? ""} stays untouched. Change the top-bar chips to replace it in place instead.`}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setPlan(null)} className="text-[11px] font-medium text-muted hover:text-ink">
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
