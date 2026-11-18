"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

/**
 * Space Mono numeral that springs to its new value instead of jumping.
 * Keeps the old text while settling; never flashes layout (min-width
 * from the caller). Under reduced motion it snaps to the value.
 */
export function Odometer({
  value,
  format = (v: number) => Math.round(v).toLocaleString(),
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduced || from === value) {
      setDisplay(value);
      return;
    }
    const controls = animate(from, value, {
      type: "spring",
      stiffness: 140,
      damping: 22,
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [value, reduced]);

  return <span className={`font-ledger tabular ${className ?? ""}`}>{format(display)}</span>;
}
