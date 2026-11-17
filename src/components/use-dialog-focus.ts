"use client";

import { useEffect, useRef } from "react";

/**
 * Keyboard behaviour for a modal panel.
 *
 * Three things a keyboard user needs and a mouse user never notices:
 *
 *   1. focus moves into the panel when it opens, so Tab continues from
 *      inside the dialog instead of the top of the page;
 *   2. Tab and Shift+Tab wrap inside the panel, so focus cannot wander
 *      onto the page behind an `aria-modal` dialog;
 *   3. Escape closes it, and focus returns to whatever opened it, so the
 *      user does not lose their place in a long list.
 *
 * The callback is held in a ref, so a caller can pass an inline arrow
 * without re-running the effect on every render (which would re-focus the
 * first control and steal the caret mid-typing).
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function useDialogFocus(active: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Capture the opener while rendering, not in the effect: a panel with
  // `autoFocus` has already moved focus inside by the time effects run, so
  // the effect would remember the panel's own control and "restore" focus
  // to a node that is about to be removed.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasActive = useRef(false);
  if (active !== wasActive.current) {
    if (active) openerRef.current = document.activeElement as HTMLElement | null;
    wasActive.current = active;
  }

  useEffect(() => {
    if (!active) return;

    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // A panel that already focused something itself (autoFocus on a
      // textarea) keeps it; otherwise move focus to the first control.
      if (panel.contains(document.activeElement)) return;
      const [first] = focusableIn(panel);
      (first ?? panel).focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      const panel = panelRef.current;
      if (!panel) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusableIn(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;

      if (event.shiftKey) {
        if (current === first || !panel.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !panel.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown, true);
      // The opener may have been removed by a route change; focus() on a
      // detached node is a no-op, so this is safe.
      openerRef.current?.focus?.();
    };
  }, [active]);

  return panelRef;
}
