"use client";

import { useEffect } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { Odometer } from "@/components/odometer";
import { SPRING } from "@/lib/motion/tokens";

/**
 * The thali — macro progress drawn as a meal plate.
 *
 * The arc is a thick plate ring, not a chart bar: saffron arc over a warm
 * hairline track, round caps, a quiet dashed plate rim. It springs to the new
 * value — never jumps. When the target closes, the plate tilts, breathes
 * slightly and the numeral flips to ledger gold (the earned color).
 *
 * Accessibility: the ring is decorative; the accessible name carries the
 * percentage in words.
 */
export function ThaliRing({
  pct,
  label,
  sublabel,
  size = 168,
  complete = false,
}: {
  /** 0–100 (clamped). */
  pct: number;
  /** Numeral in the centre — springs to the new value. */
  label: string;
  sublabel?: string;
  size?: number;
  /** Target reached — tilt + gold + breath. */
  complete?: boolean;
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, pct));
  const stroke = 9;
  const radius = (size - stroke - 6) / 2;
  const circumference = 2 * Math.PI * radius;

  const spring = useSpring(0, { stiffness: 120, damping: 22, restDelta: 0.01 });
  useEffect(() => {
    spring.set(clamped);
  }, [clamped, spring]);
  const dashoffset = useTransform(spring, (value) => circumference * (1 - value / 100));

  const numeric = Number(label.replace(/,/g, "")) || 0;

  return (
    <motion.div
      className="relative inline-grid place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(clamped)} percent of the energy target`}
      initial={false}
      animate={
        reduced
          ? { rotate: 0, scale: 1 }
          : { rotate: complete ? 2 : 0, scale: complete ? 1.02 : 1 }
      }
      transition={{ ...SPRING.settle }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        {/* plate rim */}
        <circle
          className="thali-ring-rim"
          cx={size / 2}
          cy={size / 2}
          r={radius + stroke / 2 + 3.5}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="1.5"
          strokeDasharray="2 5"
        />
        {/* track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
          strokeLinecap="round"
          opacity="0.75"
        />
        {/* progress */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={complete ? "var(--gold)" : "var(--accent)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{
            strokeDashoffset: reduced ? circumference * (1 - clamped / 100) : dashoffset,
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span
          className={`text-[26px] font-bold leading-none tracking-tight transition-colors duration-300 ${
            complete ? "text-gold" : "text-ink"
          }`}
        >
          <Odometer value={numeric} />
        </span>
        {sublabel && (
          <span className="mt-1 max-w-[110px] text-center text-[9px] leading-snug text-ink/45">
            {sublabel}
          </span>
        )}
      </div>
    </motion.div>
  );
}
