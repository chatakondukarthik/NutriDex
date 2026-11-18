"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

/**
 * The lid lifts, once — a soft aroma of the destination page wafts across
 * the kitchen on navigation, then settles. Anchored at the plate corner
 * (bottom-right), one breath — a single orchestrated beat per page-change.
 *
 * Deliberately faint: 0.22 peak, 700 ms. Presence, not performance.
 * Reduced motion (or Settings → Motion off) renders nothing.
 */
export function SpiceGlow() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const seen = useRef(pathname);
  const [blooms, setBlooms] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.page = pathname;
    if (seen.current !== pathname) {
      seen.current = pathname;
      setBlooms((n) => n + 1);
    }
  }, [pathname]);

  if (reduced || blooms === 0) return null;

  return (
    <motion.div
      key={blooms}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: [0, 0.22, 0] }}
      transition={{ duration: 0.7, times: [0, 0.45, 1], ease: [0.2, 0, 0, 1] }}
      style={{
        transformOrigin: "82% 88%",
        background:
          "radial-gradient(140vmax 140vmax at 82% 88%, color-mix(in oklab, var(--wash-ember) 70%, transparent), transparent 70%)",
      }}
    />
  );
}
