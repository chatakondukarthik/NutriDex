"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Warns before leaving an editing surface with unsaved changes.
 *
 * Three exit routes are covered:
 *  - the browser's own unload (`beforeunload`) — native prompt, not ours
 *  - in-app navigation (`<a href="/…">` clicks) — intercepted, our dialog
 *  - the browser Back button (`popstate`) — intercepted via a sentinel entry
 *
 * The dialog itself offers Save & leave / Discard changes / Stay. Save is
 * supplied by the caller and must report success; on failure the dialog
 * stays open and the user keeps editing.
 */

export interface LeaveGuardOptions {
  /** True while there are unsaved changes. */
  dirty: boolean;
  /** Attempt to save. Resolve true on success. */
  save: () => Promise<boolean>;
  /** Copy for the dialog heading; defaults to the recipe workspace. */
  heading?: string;
}

type Pending = { kind: "href"; href: string } | { kind: "back" };

export function useLeaveGuard({ dirty, save, heading }: LeaveGuardOptions) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const pendingRef = useRef<Pending | null>(null);
  const allowedRef = useRef(false);
  const armedRef = useRef(false);
  const openRef = useRef(false);

  const disarm = useCallback(() => {
    allowedRef.current = true;
    armedRef.current = false;
  }, []);

  // Arm the sentinel whenever dirty turns true, and drop it when it clears.
  useEffect(() => {
    if (!dirty || armedRef.current || allowedRef.current) return;
    armedRef.current = true;
    window.history.pushState({ nutriplanGuard: true }, "");
  }, [dirty]);

  // Back button: popstate fires when the sentinel is consumed.
  useEffect(() => {
    function onPopState() {
      if (!armedRef.current || allowedRef.current) return;
      if (openRef.current) {
        // dialog already open; swallow the extra Back press
        window.history.pushState({ nutriplanGuard: true }, "");
        return;
      }
      pendingRef.current = { kind: "back" };
      openRef.current = true;
      setOpen(true);
      // re-arm so the Back button keeps triggering the guard
      window.history.pushState({ nutriplanGuard: true }, "");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // In-app links: intercept navigation clicks while dirty.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!dirty || allowedRef.current || openRef.current) return;
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
      if (!anchor) return;
      const raw = anchor.getAttribute("href") ?? "";
      if (anchor.hasAttribute("download")) return;
      if (anchor.getAttribute("target") === "_blank") return;
      if (!raw || raw.startsWith("#") || /^[a-z]+:/i.test(raw)) return;

      let url: URL;
      try {
        url = new URL(raw, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return; // same-page navigation, nothing is lost
      }

      event.preventDefault();
      pendingRef.current = { kind: "href", href: url.pathname + url.search };
      openRef.current = true;
      setOpen(true);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  // Hard unloads (reload, close tab): the browser asks on our behalf.
  useEffect(() => {
    if (!dirty || allowedRef.current) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const finishLeave = useCallback(() => {
    const pending = pendingRef.current;
    disarm();
    openRef.current = false;
    setOpen(false);
    if (!pending) return;
    if (pending.kind === "back") {
      // undo the sentinel we re-armed, then the page itself
      window.history.go(-2);
    } else {
      router.push(pending.href);
    }
  }, [disarm, router]);

  const discard = useCallback(() => {
    setLeaveError(null);
    finishLeave();
  }, [finishLeave]);

  const saveAndLeave = useCallback(async () => {
    setBusy(true);
    setLeaveError(null);
    try {
      const ok = await save();
      if (ok) {
        finishLeave();
      } else {
        setLeaveError("Couldn’t save — fix the problem and try again.");
      }
    } finally {
      setBusy(false);
    }
  }, [finishLeave, save]);

  const stay = useCallback(() => {
    openRef.current = false;
    pendingRef.current = null;
    setLeaveError(null);
    setOpen(false);
  }, []);

  return {
    open,
    busy,
    leaveError,
    heading: heading ?? "Leave this recipe without saving?",
    stay,
    discard,
    saveAndLeave,
  };
}

/* ------------------------------------------------------------------ */
/* Dialog                                                             */
/* ------------------------------------------------------------------ */

export function LeaveGuardDialog({
  open,
  busy,
  leaveError,
  heading,
  onStay,
  onDiscard,
  onSaveAndLeave,
}: {
  open: boolean;
  busy: boolean;
  leaveError: string | null;
  heading: string;
  onStay: () => void;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
}) {
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => saveRef.current?.focus());
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onStay();
      }
    }
    window.addEventListener("keydown", onEscape, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [open, onStay]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={onStay}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-guard-title"
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="leave-guard-title" className="text-sm font-semibold">
          {heading}
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Your changes to this recipe workspace are not saved yet. You can save them now, discard
          them, or stay and keep editing.
        </p>

        {leaveError && (
          <p role="alert" className="mt-3 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[11px] text-danger-ink">
            {leaveError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy}
            className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-xs font-medium text-danger-ink transition hover:bg-danger-soft/70 disabled:opacity-50"
          >
            Discard changes
          </button>
          <button
            type="button"
            onClick={onStay}
            disabled={busy}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-xs font-medium text-ink/70 transition hover:bg-surface-2 disabled:opacity-50"
          >
            Stay and keep editing
          </button>
          <button
            ref={saveRef}
            type="button"
            onClick={onSaveAndLeave}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save & leave"}
          </button>
        </div>
      </div>
    </div>
  );
}
