"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { purgeDataAction, purgePreviewAction } from "@/app/actions";
import type {
  PurgeBlocker,
  PurgeCategoryId,
  PurgePreview,
  PurgeScope,
} from "@/lib/db/purge";

/**
 * Deleting user data by category.
 *
 * Two rules shape the UI:
 *
 *   1. the scope is explicit. "This person" removes only the active person's
 *      diary, plans, profile, pins and thresholds. "Whole household" removes
 *      shared recipes, captured foods, household preferences and the AI log.
 *      A person purge can never delete shared data, and a household purge can
 *      never use one person's selection to discard another person's diary.
 *   2. the checkboxes are a preview, not a promise. Every count comes from
 *      the server, and the server re-checks references inside the delete
 *      transaction. The UI can show a blocker and disable the button, but it
 *      cannot authorise a delete the server would refuse.
 *
 * The confirmation is deliberately two steps with an explicit
 * acknowledgement. There is no undo and no backup on this machine, so the
 * copy says so and points at the archive download before the destructive
 * button is enabled.
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

function blockerOwner(blocker: PurgeBlocker): string {
  return blocker.personName ? `${blocker.personName}'s ` : "";
}

function blockerKey(blocker: PurgeBlocker): string {
  return `${blocker.category}:${blocker.personId ?? "shared"}`;
}

export function DataDeletionPanel({ initialPreview }: { initialPreview: PurgePreview }) {
  const router = useRouter();
  const [scope, setScope] = useState<PurgeScope>(initialPreview.scope);
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
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // A server refresh (after an import, or another tab) replaces the preview.
  // Selections made against the old counts are discarded rather than carried
  // over to data the user has not seen. A refresh always describes the active
  // person scope, so it must not overwrite a household preview the user
  // switched to locally.
  useEffect(() => {
    if (initialPreview.scope !== scopeRef.current) return;
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
        const covered = blocker.resolvable && selected.has(blocker.category);
        if (!covered) list.push({ owner: category.label, blocker });
      }
    }
    return list;
  }, [categories, selected]);

  const hasPersonalBlocker = unresolved.some(({ blocker }) => !blocker.resolvable);
  const selectedCategories = categories.filter((category) => selected.has(category.id));
  const selectedItems = selectedCategories.reduce((sum, category) => sum + category.count, 0);
  const nothingToDelete = selectable.length === 0;
  const canConfirm = selectedItems > 0 && unresolved.length === 0 && !pending;
  const scopeLabel = scope === "person" ? (preview.personName ?? "this person") : "the household";

  function resetFeedback() {
    setError(null);
    setOutcome(null);
  }

  function switchScope(next: PurgeScope) {
    if (next === scope || pending) return;
    resetFeedback();
    setConfirming(false);
    setAcknowledged(false);
    setSelected(new Set());
    setScope(next);

    startTransition(async () => {
      const nextPreview = await purgePreviewAction(next);
      setPreview(nextPreview);
      setScope(nextPreview.scope);
    });
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
      const result = await purgeDataAction(preview.scope, categoriesToDelete);
      setPreview(result.preview);
      setScope(result.preview.scope);

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

  const emptyCopy =
    scope === "person"
      ? `${scopeLabel} has no diary entries, plans, body profile, saved defaults or target thresholds to delete. Shared foods and recipes are kept.`
      : "There are no shared recipes, captured foods, household preferences or AI activity to delete. Foods, retention factors and settings that ship with the app are not user content and are kept.";

  return (
    <section
      aria-labelledby="data-deletion-title"
      className="rounded-2xl border border-line bg-surface p-5 shadow-card"
    >
      <h2 id="data-deletion-title" className="text-sm font-semibold">
        Delete data
      </h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Choose a scope, then what to remove from this machine. There is no undo and no backup here,
        so download an{" "}
        <a
          href={scope === "person" ? "/api/export?scope=person" : "/api/export"}
          className="underline underline-offset-2 transition hover:text-ink"
        >
          archive
        </a>{" "}
        first if you might want the data back. Your saved AI keys are not included in these
        categories; remove them in AI access above.
      </p>

      <div
        role="group"
        aria-label="Deletion scope"
        className="mt-4 inline-flex rounded-control border border-line bg-bg p-0.5"
      >
        <button
          type="button"
          aria-pressed={scope === "person"}
          onClick={() => switchScope("person")}
          disabled={pending}
          className={`rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
            scope === "person" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          This person
        </button>
        <button
          type="button"
          aria-pressed={scope === "household"}
          onClick={() => switchScope("household")}
          disabled={pending}
          className={`rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
            scope === "household" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          Whole household
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        {scope === "person"
          ? `${scopeLabel}'s diary, plans, body profile, saved defaults and thresholds only. Other people and the shared library are untouched.`
          : "The shared recipe and food library, household preferences and AI activity. Other people's diaries and plans are never deleted from here."}
      </p>

      {nothingToDelete ? (
        <p className="mt-4 rounded-xl border border-line bg-bg px-4 py-3 text-[11px] text-muted">
          {emptyCopy}
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
              const descriptionId = `purge-${scope}-${category.id}-description`;

              return (
                <div
                  key={category.id}
                  className={`rounded-xl border p-3 transition ${
                    checked ? "border-danger-line bg-danger-soft/40" : "border-line bg-bg"
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
                        const covered = blocker.resolvable && selected.has(blocker.category);
                        return (
                          <li key={blockerKey(blocker)}>
                            Used by {blockerOwner(blocker)}
                            {blocker.label.toLowerCase()} ({plural(blocker.count, blocker.unit)}).{" "}
                            {covered
                              ? "That category is selected, so it will be removed too."
                              : blocker.resolvable
                                ? `Select ${blocker.label} too, or this delete is refused.`
                                : `Clear it in ${blocker.personName ?? "that person"}'s scope first.`}
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
              {[
                ...new Set(
                  unresolved.map(
                    ({ blocker }) =>
                      `${blockerOwner(blocker)}${blocker.label.toLowerCase()}`,
                  ),
                ),
              ].join(", ")}{" "}
              still reference the data you selected.{" "}
              {hasPersonalBlocker
                ? "Clear those rows in the relevant person's scope first."
                : "Select those categories too, or remove the references first."}
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
                Delete {plural(selectedItems, "item")} from {scopeLabel}?
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
