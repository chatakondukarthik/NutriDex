"use client";

/**
 * The ink stamp — a rotated rounded-check in a wax-seal circle, drawn
 * in for ~380 ms when a save is committed. Pure CSS (`.animate-stamp-in`
 * in globals.css); the stroke draw is faked with scale/rotate overshoot
 * so it works with reduced motion off without SVG path machinery.
 */
export function StampCheck({ label }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? "Saved"}
      className="animate-stamp-in inline-grid h-9 w-9 place-items-center rounded-full border-2 border-[color:var(--leaf)] text-[color:var(--leaf)]"
      style={{ borderStyle: "double" }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
