/**
 * The Thali Ledger motion vocabulary — one place, every surface.
 *
 * Linear-grade precision: short springs, emphasized easing, transform and
 * opacity only. Values mirror the CSS custom properties in globals.css so
 * JS-driven and CSS-driven motion agree.
 */
export const SPRING = {
  /** Micro — buttons, toggles, chips. */
  snap: { type: "spring", stiffness: 520, damping: 34 },
  /** Sheets, dialogs, reveals. */
  settle: { type: "spring", stiffness: 260, damping: 26 },
  /** Food falls into the diary. */
  drop: { type: "spring", stiffness: 330, damping: 22 },
} as const;

export const EASE = {
  emphasis: [0.2, 0, 0, 1] as const,
  swipe: [0.22, 1, 0.36, 1] as const,
} as const;

export const DUR = {
  micro: 0.14,
  quick: 0.22,
  move: 0.38,
  page: 0.48,
} as const;
