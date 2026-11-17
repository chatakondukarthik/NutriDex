"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { fmtDay } from "@/lib/format";
import { SLOTS, SLOT_LABELS, weekDays, type Slot } from "@/lib/plan";

/**
 * The keyboard equivalent of dragging a placed item.
 *
 * Drag-and-drop is the fast path for a mouse, but it cannot be performed
 * from the keyboard: a draggable element has nothing to activate. This
 * dialog is opened by the grip button (Enter or Space), offers the same
 * week's days and the same four slots, and calls the same `move` that a
 * drop does, so the two paths cannot diverge.
 */
export function PlanMoveDialog({
  name,
  day: initialDay,
  slot: initialSlot,
  week,
  onMove,
  onClose,
}: {
  name: string;
  day: string;
  slot: Slot;
  week: string;
  onMove: (day: string, slot: Slot) => void;
  onClose: () => void;
}) {
  const days = weekDays(week);
  const [day, setDay] = useState(initialDay);
  const [slot, setSlot] = useState<Slot>(initialSlot);
  const panelRef = useDialogFocus(true, onClose);
  const unchanged = day === initialDay && slot === initialSlot;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-entry-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-4 shadow-card outline-none"
      >
        <h2 id="move-entry-title" className="text-sm font-semibold">
          Move “{name}”
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Pick the day and meal. The amount travels with the item; nothing else changes.
        </p>

        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (unchanged) {
              onClose();
              return;
            }
            onMove(day, slot);
            onClose();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-faint">
                Day
              </span>
              <select
                value={day}
                onChange={(event) => setDay(event.target.value)}
                aria-label="Day"
                className="w-full rounded-control border border-line bg-surface px-2.5 py-2 text-sm"
              >
                {days.map((option) => (
                  <option key={option} value={option}>
                    {fmtDay(option)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-faint">
                Meal
              </span>
              <select
                value={slot}
                onChange={(event) => setSlot(event.target.value as Slot)}
                aria-label="Meal"
                className="w-full rounded-control border border-line bg-surface px-2.5 py-2 text-sm"
              >
                {SLOTS.map((option) => (
                  <option key={option} value={option}>
                    {SLOT_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={unchanged}
              className="rounded-lg bg-accent px-4 py-1.5 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-strong disabled:opacity-50"
            >
              Move
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
