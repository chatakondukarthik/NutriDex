"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useMotionEnabled } from "@/components/theme-provider";
import { SPRING } from "@/lib/motion/tokens";

/**
 * The page head of every screen — one pattern, no exceptions.
 *
 * Fraunces display title, a Space Mono kicker for ledger metadata, and a
 * short brass rule that fades into a hairline. Actions (if any) sit on the
 * right, keyline-aligned. Prose leads stay human-readable, not shouted.
 *
 * The rise is part of the pattern: every route settles in the same way.
 */
export function PageHeader({
  title,
  kicker,
  lead,
  children,
}: {
  title: string;
  /** Short ledger-style label in Space Mono caps, e.g. "NOVEMBER 2026 · WEEK 47". */
  kicker?: string;
  /** One-line prose under the title — full case, for humans. */
  lead?: ReactNode;
  /** Right-side actions. */
  children?: ReactNode;
}) {
  const enabled = useMotionEnabled();

  const content = (
    <>
      <div className="min-w-0">
        {kicker ? (
          <p className="font-ledger text-[9px] uppercase tracking-[0.22em] text-accent">
            {kicker}
          </p>
        ) : null}
        <h1 className="font-display mt-1.5 text-[30px] font-bold leading-none tracking-tight text-ink">
          {title}
        </h1>
        {lead ? (
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted">{lead}</p>
        ) : null}
        <div className="thali-rule mt-3" aria-hidden="true" />
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </>
  );

  if (!enabled) {
    return <div className="flex flex-wrap items-end justify-between gap-3">{content}</div>;
  }

  return (
    <motion.div
      className="flex flex-wrap items-end justify-between gap-3"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.settle }}
    >
      {content}
    </motion.div>
  );
}
