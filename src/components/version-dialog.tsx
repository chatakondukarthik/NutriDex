"use client";

import { useEffect } from "react";
import { useDialogFocus } from "@/components/use-dialog-focus";

/**
 * The save checkpoint for a recipe with content changes.
 *
 * One question, two honest answers: keep the history and add a new version,
 * or deliberately rewrite the current one (with the blast radius named).
 * Layout-only saves never see this — they persist silently.
 */
export function VersionDialog({
  open,
  onClose,
  versionNo,
  versionLabel,
  replacePinned,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  /** The version being replaced; null on first save. */
  versionNo: number | null;
  /** Optional version label, e.g. "less oil". */
  versionLabel?: string | null;
  /** How many plan/diary entries pin the current version. */
  replacePinned: number;
  /** Pick the answer; the caller saves and closes. */
  onChoose: (mode: "new-version" | "replace-current") => void;
}) {
  const panelRef = useDialogFocus(open, onClose);

  useEffect(() => {
    if (!open) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [open, onClose]);

  if (!open) return null;
  const isFirstSave = versionNo == null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-dialog-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-card outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="font-ledger text-[9px] uppercase tracking-[0.22em] text-accent">
          {isFirstSave ? "Save the recipe" : "Save changes"}
        </p>
        <h2 id="version-dialog-title" className="mt-1.5 text-base font-semibold">
          {isFirstSave ? "First version" : `How should this be saved?`}
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {isFirstSave
            ? "This creates v1 of the recipe. Plans and the diary will reference it."
            : "Your changes would either extend the history or rewrite the current version."}
        </p>

        <button
          type="button"
          onClick={() => onChoose("new-version")}
          autoFocus
          className="mt-4 flex w-full flex-col items-start rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-left transition hover:border-accent/70 hover:bg-accent/15"
        >
          <span className="text-sm font-semibold text-ink">
            {isFirstSave ? "Save as v1" : `Save as v${(versionNo ?? 0) + 1}`}
          </span>
          <span className="mt-0.5 text-[10px] leading-snug text-muted">
            {isFirstSave
              ? "The recipe is created; nothing pinned yet."
              : `v${versionNo} stays untouched — plans and the diary keep the old values.`}
          </span>
        </button>

        {!isFirstSave && (
          <button
            type="button"
            onClick={() => onChoose("replace-current")}
            className="mt-2 flex w-full flex-col items-start rounded-xl border border-warn-line bg-warn-soft/40 px-4 py-3 text-left transition hover:border-warn-line"
          >
            <span className="text-sm font-semibold text-warn-ink">
              Replace v{versionNo} in place{replacePinned > 0 ? "" : ""}
            </span>
            <span className="mt-0.5 text-[10px] leading-snug text-warn-ink/80">
              {replacePinned > 0
                ? `${replacePinned} plan or diary ${replacePinned === 1 ? "entry" : "entries"} pinned to v${versionNo} will see the new values. History is rewritten.`
                : "v" + versionNo + " is rewritten in place — no fork, no separate history."}
            </span>
          </button>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="text-[11px] font-medium text-muted underline-offset-2 hover:text-ink">
            Keep editing
          </button>
          {versionLabel ? <p className="truncate text-[10px] text-ink/35">“{versionLabel}”</p> : null}
        </div>
      </div>
    </div>
  );
}
