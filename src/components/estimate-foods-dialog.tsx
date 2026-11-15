"use client";

/**
 * The scare, on purpose.
 *
 * Filling food nutrients with AI writes estimates into the shared food
 * records — every recipe, plan and diary entry that uses those foods will
 * reuse them silently. The user gets the full list of what will change
 * before committing, plus the rule that known values are never touched.
 */
export function EstimateFoodsDialog({
  open,
  foods,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  foods: Array<{ id: string; name: string; missing: number }>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  const total = foods.reduce((sum, food) => sum + food.missing, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="estimate-foods-title"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-warn-line bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-warn-line bg-warn-soft px-5 py-3">
          <h2 id="estimate-foods-title" className="text-sm font-semibold text-warn-ink">
            ⚠ These values will be AI estimates
          </h2>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] leading-relaxed text-muted">
            The food records below will be filled in with AI estimates. Every recipe, plan and
            diary entry that uses these foods will reuse them <strong>permanently</strong>.
            Known values are never overwritten, and you can edit any value afterwards — but a
            bad estimate here is not undoable for existing saved plans.
          </p>

          <ul className="mt-3 max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-bg text-[11px]">
            {foods.map((food) => (
              <li key={food.id} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
                <span className="min-w-0 truncate">{food.name}</span>
                <span className="tabular shrink-0 text-ink/40">
                  {food.missing} unknown{food.missing === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[10px] leading-relaxed text-ink/45">
            {foods.length} food{foods.length === 1 ? "" : "s"} · about {total} estimated
            value{total === 1 ? "" : "s"} · one AI call each
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
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-danger px-4 py-2 text-xs font-semibold text-white transition hover:bg-danger-strong disabled:opacity-50"
          >
            {busy ? "Estimating…" : `Yes, estimate ${foods.length} food${foods.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
