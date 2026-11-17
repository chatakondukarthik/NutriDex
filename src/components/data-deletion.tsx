"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { purgeDataAction } from "@/app/actions";
import type { PurgeBlocker, PurgeCategoryId, PurgePreview } from "@/lib/db/purge";

/**
 * Deleting user data by category.
 *
 * The checkboxes are a preview, not a promise: every count comes from the
 * server, and the server re-checks references inside the delete transaction.
 * The UI can therefore show a blocker and disable the button, but it cannot
 * authorise a delete the server would refuse.
 *
 * The confirmation is deliberately two steps with an explicit acknowledgement.
 * There is no undo and no backup on this machine, so the copy says so and
 * points at the archive download before the destructive button is enabled.
 */

type Outcome = {
  deleted: Partial<Record<PurgeCategoryId, number>>;
  filesRemoved: number;
  warnings: string[];
};

function plural(count: number, unit: string): string {
  if (count === 1) return `${count} ${unit}`;
  const pluralUnit = unit.endsWith("y") ? `${unit.slice(0, -1)}ies` : `${unit}s`;
  return `${count} ${pluralUnit}`;
}

export function DataDeletionPanel({ initialPreview }: { initialPreview: PurgePreview }) {
  const router = useRouter();
  const [preview, setPreview] = useState(initialPreview);
  const [selected, setSelected] = useState<Set<PurgeCategoryId>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();

  const allRef = useRef<HTMLInputElement>(null);
  const acknowledgeRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);
  const focusOutcome = useRef(false);

  // A server refresh (after an import, or another tab) replaces the preview.
  // Selections made against the old counts are discarded rather than carried
  // over to data the user has not seen.
  useEffect(() => {
    setPreview(initialPreview);
    setSelected(new Set());
    setConfirming(false);
    setAcknowledged(false);
  }, [initialPreview]);

  const categories = preview.categories;
  const selectable = useMemo(() => categories.filter((category) => category.count > 0), [categories]);
  const allSelected =
    selectable.length > 0 && selectable.every((category) => selected.has(category.id));
  const someSelected = selectable.some((category) => selected.has(category.id));

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const unresolved = useMemo(() => {
    const list: Array<{ owner: string; blocker: PurgeBlocker }> = [];
    for (const category of categories) {
      if (!selected.has(category.id)) continue;
      for (const blocker of category.blockers) {
        if (!selected.has(blocker.category)) list.push({ owner: category.label, blocker });
      }
    }
    return list;
  }, [categories, selected]);

  const selectedCategories = categories.filter((category) => selected.has(category.id));
  const selectedItems = selectedCategories.reduce((sum, category) => sum + category.count, 0);
  const nothingToDelete = selectable.length === 0;
  const canConfirm = selectedItems > 0 && unresolved.length === 0 && !pending;

  function resetFeedback() {
    setError(null);
    setOutcome(null);
  }

  function toggle(id: PurgeCategoryId) {
    resetFeedback();
    setConfirming(false);
    setAcknowledged(false);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    resetFeedback();
    setConfirming(false);
    setAcknowledged(false);
    setSelected(allSelected ? new Set() : new Set(selectable.map((category) => category.id)));
  }

  function openConfirm() {
    resetFeedback();
    setConfirming(true);
    setAcknowledged(false);
  }

  function cancel() {
    setConfirming(false);
    setAcknowledged(false);
  }

  // The confirmation is inline, but it still owns focus while it is open.
  // Returning focus matters most on success: when the last category is gone
  // the trigger unmounts, so focus goes to the result instead of <body>.
  useEffect(() => {
    if (confirming) {
      acknowledgeRef.current?.focus();
      wasConfirming.current = true;
      return;
    }
    if (!wasConfirming.current) return;
    wasConfirming.current = false;
    const focusResult = focusOutcome.current;
    focusOutcome.current = false;
    const target = () => (focusResult ? outcomeRef.current : triggerRef.current)?.focus();
    // Focus synchronously, then again after the commit that mounted the
    // trigger/result. The second call covers a state update in the same
    // transition swapping the node between the two.
    target();
    const timer = window.setTimeout(target, 0);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  function perform() {
    if (!canConfirm || !acknowledged) return;
    const categoriesToDelete = [...selected];
    resetFeedback();

    startTransition(async () => {
      const result = await purgeDataAction(categoriesToDelete);
      setPreview(result.preview);

      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
        setAcknowledged(false);
        return;
      }

      setOutcome({
        deleted: result.deleted,
        filesRemoved: result.filesRemoved,
        warnings: result.warnings,
      });
      focusOutcome.current = true;
      setSelected(new Set());
      setConfirming(false);
      setAcknowledged(false);
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="data-deletion-title"
      className="rounded-2xl border border-line bg-surface p-5 shadow-card"
    >
      <h2 id="data-deletion-title" className="text-sm font-semibold">
        Delete data
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Choose what to remove from this machine. There is no undo and no backup here, so download
        an{" "}
        <a
          href="/api/export"
          className="underline underline-offset-2 transition hover:text-ink"
        >
          archive
        </a>{" "}
        first if you might want the data back. Your saved AI keys are not included in these
        categories; remove them in AI access above.
      </p>

      {nothingToDelete ? (
        <p className="mt-4 rounded-xl border border-line bg-bg px-4 py-3 text-[11px] text-muted">
          There is no user data to delete. Foods, retention factors and settings that ship with the
          app are not user content and are kept.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[11px] font-medium text-ink">
              <input
                ref={allRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={pending}
              />
              Select everything
            </label>
            <span className="text-[10px] tabular text-ink/40">
              {selectedCategories.length === 0
                ? "Nothing selected"
                : `${selectedCategories.length} ${
                    selectedCategories.length === 1 ? "category" : "categories"
                  } · ${plural(selectedItems, "item")}`}
            </span>
          </div>

          <fieldset className="mt-3 space-y-2" disabled={pending}>
            <legend className="sr-only">Data to delete</legend>
            {categories.map((category) => {
              const checked = selected.has(category.id);
              const empty = category.count === 0;
              const descriptionId = `purge-${category.id}-description`;

              return (
                <div
                  key={category.id}
                  className={`rounded-xl border p-3 transition ${
                    checked
                      ? "border-danger-line bg-danger-soft/40"
                      : "border-line bg-bg"
                  } ${empty ? "opacity-60" : ""}`}
                >
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      disabled={empty}
                      onChange={() => toggle(category.id)}
                      aria-describedby={descriptionId}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-[11px] font-semibold text-ink">
                          {category.label}
                        </span>
                        <span className="text-[10px] tabular text-ink/45">
                          {empty ? "None" : plural(category.count, category.unit)}
                          {category.detail ? ` · ${category.detail}` : ""}
                        </span>
                      </span>
                      <span
                        id={descriptionId}
                        className="mt-0.5 block text-[10px] leading-relaxed text-muted"
                      >
                        {category.description}
                      </span>
                    </span>
                  </label>

                  {category.blockers.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-line/70 pt-2 text-[10px] text-warn-ink">
                      {category.blockers.map((blocker) => {
                        const covered = selected.has(blocker.category);
                        return (
                          <li key={blocker.category}>
                            Used by {blocker.label.toLowerCase()} (
                            {plural(blocker.count, blocker.unit)}).{" "}
                            {covered
                              ? "That category is selected, so it will be removed too."
                              : `Select ${blocker.label} too, or this delete is refused.`}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </fieldset>

          {unresolved.length > 0 && (
            <p
              role="status"
              className="mt-3 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[11px] text-warn-ink"
            >
              {[...new Set(unresolved.map(({ blocker }) => blocker.label))].join(" and ")} still
              reference the data you selected. Select those categories too, or remove the
              references first.
            </p>
          )}

          {!confirming ? (
            <button
              ref={triggerRef}
              type="button"
              onClick={openConfirm}
              disabled={!canConfirm}
              className="mt-4 rounded-lg bg-danger px-4 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Delete selected data…
            </button>
          ) : (
            <div
              role="group"
              aria-labelledby="purge-confirm-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  cancel();
                }
              }}
              className="mt-4 rounded-xl border border-danger-line bg-danger-soft p-4"
            >
              <h3 id="purge-confirm-title" className="text-xs font-semibold text-danger-ink">
                Delete {plural(selectedItems, "item")}?
              </h3>
              <ul className="mt-2 space-y-0.5 text-[10px] text-danger-ink">
                {selectedCategories.map((category) => (
                  <li key={category.id}>
                    {category.label} — {plural(category.count, category.unit)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] leading-relaxed text-danger-ink">
                This cannot be undone. Exported archives are unaffected; AI keys and the foods,
                retention factors and settings that ship with the app are kept.
              </p>

              <label className="mt-3 flex items-start gap-2 text-[11px] font-medium text-danger-ink">
                <input
                  ref={acknowledgeRef}
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={pending}
                  className="mt-0.5"
                />
                I understand this cannot be undone.
              </label>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={perform}
                  disabled={!acknowledged || pending}
                  className="rounded-lg bg-danger px-4 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Deleting…" : "Delete permanently"}
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  disabled={pending}
                  className="rounded-lg border border-danger-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink/70 transition hover:text-ink disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[11px] text-danger-ink"
        >
          {error}
        </p>
      )}

      {outcome && (
        <div
          ref={outcomeRef}
          role="status"
          tabIndex={-1}
          className="mt-3 rounded-lg border border-line bg-bg px-3 py-2 text-[11px] outline-none"
        >
            <p className="font-medium">Deleted.</p>
            <ul className="mt-1 space-y-0.5 text-[10px] text-muted">
              {Object.entries(outcome.deleted)
                .filter(([, count]) => count > 0)
                .map(([id, count]) => {
                  const category = categories.find((candidate) => candidate.id === id);
                  return (
                    <li key={id}>
                      {category?.label ?? id} — {plural(count, category?.unit ?? "item")}
                    </li>
                  );
                })}
              {outcome.filesRemoved > 0 && (
                <li>{plural(outcome.filesRemoved, "evidence image")}</li>
              )}
            </ul>
            {outcome.warnings.length > 0 && (
              <ul className="mt-2 space-y-1 text-[10px] text-warn-ink">
                {outcome.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
        </div>
      )}
    </section>
  );
}
