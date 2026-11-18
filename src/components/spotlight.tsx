"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { SPRING } from "@/lib/motion/tokens";

/**
 * The spotlight card — a brass edge-ring that materialises near the cursor,
 * with a physical shelf feel: rises in on mount (staggered by `index`) and
 * leans under the pointer like a jar you are reaching for.
 *
 * Linear's edge-glow, remixed for The Thali Ledger — pure transforms,
 * no layout reads, one style write per pointermove.
 */
export function Spotlight({
  className,
  style,
  children,
  as: Tag = "div",
  index = 0,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  as?: "div" | "li" | "article" | "button";
  /** Position in the grid — used for the entrance stagger. */
  index?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const MotionTag = motion[Tag] as typeof motion.div;

  function handleMouseMove(event: MouseEvent<HTMLElement>): void {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    el.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  }

  return (
    <MotionTag
      ref={ref as never}
      onMouseMove={handleMouseMove}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.settle, delay: Math.min(index * 0.035, 0.32) }}
      whileHover={reduced ? undefined : { y: -4, rotateX: 4.5, rotateZ: -0.4 }}
      style={{ transformPerspective: 900, ...style }}
      className={`spotlight ${className ?? ""}`}
    >
      {children}
    </MotionTag>
  );
}
