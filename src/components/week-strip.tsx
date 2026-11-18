"use client";

import { motion, useReducedMotion } from "motion/react";
import { SPRING } from "@/lib/motion/tokens";

/**
 * Your week — seven thin plates, one per day, kcal per day from the diary.
 * The ledger's first honest sparkline: springs to height on mount, Mono
 * numerals, today lit in brass. Informational, never animated for show.
 */
export function WeekStrip({
  days,
  today,
}: {
  days: Array<{ day: string; label: string; kcal: number | null }>;
  today: string;
}) {
  const reduced = useReducedMotion();
  const values = days.map((d) => d.kcal ?? 0);
  const max = Math.max(1, ...values);
  const target = Math.max(1, ...values.filter((v) => v > 0), 1200);

  return (
    <section
      aria-label="This week in the kitchen"
      className="dotgrid mb-5 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold tracking-tight text-ink">
          Your week
        </h2>
        <p className="font-ledger text-[9px] uppercase tracking-[0.18em] text-faint">
          kcal by day
        </p>
      </div>

      <div className="mt-4 grid grid-cols-7 items-end gap-2">
        {days.map((d, index) => {
          const kcal = d.kcal ?? 0;
          const heightPct = Math.max(4, (kcal / target) * 100);
          const isToday = d.day === today;

          return (
            <div key={d.day} className="flex flex-col items-center gap-1.5">
              <span className="font-ledger text-[10px] font-bold tabular text-ink/80">
                {kcal > 0 ? Math.round(kcal).toLocaleString() : "—"}
              </span>
              <div className="flex h-20 w-full items-end justify-center rounded-md bg-ink/[0.05] py-1">
                <motion.div
                  className={`w-full max-w-[26px] rounded-sm ${isToday ? "bg-accent" : "bg-accent/60"}`}
                  initial={reduced ? false : { scaleY: 0, opacity: 0.4 }}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ ...SPRING.settle, delay: 0.15 + index * 0.055 }}
                  style={{ height: `${heightPct}%`, transformOrigin: "bottom center" }}
                />
              </div>
              <span className={`font-ledger text-[9px] uppercase tracking-wider ${isToday ? "text-accent" : "text-faint"}`}>
                {d.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 border-t border-line/70 pt-2 text-[9px] leading-relaxed text-faint">
        From the diary, per day. Days with no entries show nothing — unknown is not zero.
      </p>
    </section>
  );
}
