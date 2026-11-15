"use client";

import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMotionEnabled } from "@/components/theme-provider";

/**
 * A short fade-and-lift on every route change.
 *
 * Deliberately opacity-first: a transform on an ancestor would become the
 * containing block for the sticky side panels while it runs.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const enabled = useMotionEnabled();

  if (!enabled) return <>{children}</>;

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
