"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING } from "@/lib/motion/tokens";

/**
 * Scroll-into-view reveal — the workhorse entrance for every surface.
 * One rise per view (whileInView, once), spring-settle, blur-free.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 12,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ ...SPRING.settle, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered children — cards, tiles, list rows blooming in sequence.
 * Children must be `StaggerItem`s (or any motion component) to inherit
 * the variants.
 */
export function Stagger({
  children,
  className,
  delay = 0,
  gap = 0.04,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  gap?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-30px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  y = 10,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { ...SPRING.settle } },
      }}
    >
      {children}
    </motion.div>
  );
}
