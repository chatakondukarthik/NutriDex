"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseRecipeFragment } from "@/lib/recipe-fragment";

/**
 * Paste a copied fragment of recipe blocks back onto the canvas.
 *
 * Validation happens exactly once, here, against the pure parser — the
 * canvas never sees JSON that failed the check.
 */
export function PasteFragmentDialog({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  /** Receives the raw fragment JSON; caller applies it and reports success. */
  onInsert: (raw: string) => boolean;
}) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setRaw("");
    setError(null);
    setNotice(null);
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onEscape, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [open, onClose]);

  const fillFromClipboard = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError("The clipboard is empty.");
        return;
      }
      setRaw(text);
      setNotice("Clipboard pasted. Check it, then Insert.");
    } catch {
      setError("The browser refused clipboard access. Paste by hand instead (Ctrl/Cmd+V).");
    }
  }, []);

  const insert = useCallback(() => {
    setError(null);
    setNotice(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setError("Paste a fragment first.");
      return;
    }
    const parsed = parseRecipeFragment(trimmed);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const applied = onInsert(trimmed);
    if (applied) {
      onClose();
    } else {
      setError("That fragment could not be inserted.");
    }
  }, [raw, onInsert, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-fragment-title"
        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="paste-fragment-title" className="text-sm font-semibold">
            Paste a recipe fragment
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-ink/5 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Copied blocks from any recipe work anywhere. Paste the JSON here and the blocks arrive
          as their own blocks — nothing about the original recipe is linked or changed.
        </p>

        <textarea
          ref={textareaRef}
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value);
            setError(null);
            setNotice(null);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              insert();
            }
          }}
          spellCheck={false}
          placeholder='{"app":"nutriplan-flow","version":2,"nodes":[…'
          aria-label="Fragment JSON"
          className="mt-3 h-44 w-full resize-y rounded-xl border border-line bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed outline-none placeholder:text-ink/30 focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
        />

        {error && (
          <p role="alert" className="mt-2 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[11px] text-danger-ink">
            {error}
          </p>
        )}
        {notice && !error && <p className="mt-2 text-[11px] text-ink/50">{notice}</p>}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={fillFromClipboard}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-xs font-medium text-ink/70 transition hover:bg-surface-2"
          >
            Paste from clipboard
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ink/35">Ctrl/Cmd+Enter to insert</span>
            <button
              type="button"
              onClick={insert}
              disabled={!raw.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
            >
              Insert blocks
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
