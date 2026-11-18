"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { SPRING } from "@/lib/motion/tokens";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { NutrientPicker } from "@/components/nutrient-picker";
import type { NutrientCode } from "@/lib/nutrition/types";

/**
 * The scare, on purpose.
 *
 * Filling food nutrients with AI writes estimates into the shared food
 * records — every recipe, plan and diary entry that uses those foods will
 * reuse them silently. The user gets the full list of what will change
 * before committing, picks exactly which nutrients the AI may propose, and
 * knows known values are never touched.
 */
export function EstimateFoodsDialog({
  open,
  foods,
  busy,
  onCancel,
  onConfirm,
  provenanceNote,
}: {
  open: boolean;
  foods: Array<{ id: string; name: string; missingCodes: NutrientCode[] }>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (codes: NutrientCode[]) => void;
  /** Optional context line, e.g. where this food came from. */
  provenanceNote?: string;
}) {
  const panelRef = useDialogFocus(open, onCancel);
  const [selected, setSelected] = useState<Set<NutrientCode>>(() =>
    new Set(foods.flatMap((food) => food.missingCodes)),
  );

  // Reset to "everything missing" every time the dialog is reopened.
  useEffect(() => {
    if (open) setSelected(new Set(foods.flatMap((food) => food.missingCodes)));
  }, [open, foods]);

  const options = useMemo(
    () => [...new Set(foods.flatMap((food) => food.missingCodes))],
    [foods],
  );

  const perFood = useMemo(
    () =>
      foods.map((food) => ({
        ...food,
        picked: food.missingCodes.filter((code) => selected.has(code)).length,
      })),
    [foods, selected],
  );
  const total = perFood.reduce((sum, food) => sum + food.picked, 0);
  const foodsToRun = perFood.filter((food) => food.picked > 0).length;

  return (
    open && (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="estimate-foods-title"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ ...SPRING.settle }}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-warn-line bg-surface shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-warn-line bg-warn-soft px-5 py-3">
          <h2 id="estimate-foods-title" className="text-sm font-semibold text-warn-ink">
            ⚠ These values will be AI estimates
          </h2>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] leading-relaxed text-muted">
            {foods.length === 1
              ? "This food record will be filled in with AI estimates."
              : "The food records below will be filled in with AI estimates."}{" "}
            Every recipe, plan and diary entry that uses{" "}
            {foods.length === 1 ? "it" : "these foods"} will reuse them <strong>permanently</strong>.
            Known values are never overwritten, and you can edit any value afterwards — but a
            bad estimate here is not undoable for existing saved plans.
          </p>
          {provenanceNote && (
            <p className="mt-2 text-[10px] leading-snug text-ink/50">{provenanceNote}</p>
          )}

          <ul className="mt-3 max-h-40 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-bg text-[11px]">
            {perFood.map((food) => (
              <li key={food.id} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
                <span className="min-w-0 truncate">{food.name}</span>
                <span
                  className="tabular shrink-0 text-ink/40"
                  title={`${food.picked} of ${food.missingCodes.length} missing nutrient${food.missingCodes.length === 1 ? "" : "s"} selected`}
                >
                  {food.picked}/{food.missingCodes.length} selected
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink/40">
              Fill which nutrients?
            </p>
            <div className="mt-1.5">
              <NutrientPicker
                options={options}
                value={selected}
                onChange={setSelected}
                disabled={busy}
                idPrefix="batch"
              />
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-ink/45">
              Only the nutrients you select are estimated — unselected ones stay exactly as they
              are, and known values are never replaced.
            </p>
          </div>

          <p className="mt-3 text-[10px] leading-relaxed text-ink/45">
            {total === 0
              ? "Select at least one missing nutrient above."
              : `${foods.length} food${foods.length === 1 ? "" : "s"} · about ${total} estimated value${total === 1 ? "" : "s"} · one AI call per food that still has something to fill`}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-bg px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink/70 transition hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm([...selected])}
            disabled={busy || total === 0}
            title={total === 0 ? "Select at least one missing nutrient above." : undefined}
            className="rounded-lg bg-danger px-4 py-2 text-xs font-semibold text-white transition hover:bg-danger-strong disabled:opacity-50"
          >
            {busy ? "Estimating…" : `Yes, estimate ${foodsToRun} food${foodsToRun === 1 ? "" : "s"}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
    )
  );
}
