"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

/**
 * The drop-burst — one radial slash of speed lines, fired once per drop.
 * Manga vocabulary, household manners: 16 skewed strokes + sesame dots,
 * ~550 ms, transform-free-ish canvas, never blocking the drop underneath.
 * Reduced motion renders nothing.
 */
export default function DropBurst({ fire }: { fire: boolean }) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (!fire || fired.current || reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    fired.current = true;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 120;
    const height = parent?.clientHeight ?? 64;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;
    ctx.scale(dpr, dpr);

    const cx = width / 2;
    const cy = height / 2;
    const COLORS = ["#E8A33D", "#C4531F", "#F0E4C8", "#8A5A1B"];

    // 16 speed lines, alternating reach, slight fan skew
    const slashes = Array.from({ length: 16 }, (_, index) => {
      const baseAngle = (Math.PI * 2 * index) / 16;
      const angle = baseAngle + (Math.random() - 0.5) * 0.22;
      return {
        angle,
        len: (index % 2 === 0 ? 1 : 0.62) * (Math.min(width, height) * 0.75 + Math.random() * 14),
        width: 1 + Math.random() * 1.6,
        color: COLORS[index % COLORS.length],
      };
    });
    // 10 sesame dots that fall after the slash
    const dots = Array.from({ length: 10 }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: 40 + Math.random() * 70,
      r: 0.8 + Math.random() * 1.6,
      color: COLORS[(Math.random() * COLORS.length) | 0],
    }));

    let raf = 0;
    const started = performance.now();
    function frame(now: number) {
      const elapsed = now - started;
      const t = Math.min(1, elapsed / 550);
      ctx.clearRect(0, 0, width, height);

      // Speed lines — drawn from center outward, fading with t
      for (const slash of slashes) {
        const reach = t < 0.35 ? (t / 0.35) : 1;
        const alpha = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
        const from = 8 + reach * 6;
        const to = from + slash.len * (t < 0.35 ? reach : 1);
        ctx.strokeStyle = slash.color;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.lineWidth = slash.width * (1 - t * 0.5);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(slash.angle) * from, cy + Math.sin(slash.angle) * from);
        ctx.lineTo(cx + Math.cos(slash.angle) * to, cy + Math.sin(slash.angle) * to);
        ctx.stroke();
      }

      // Sesame dots — launched at slash-time zero, gravity takes them
      const dotT = Math.min(1.4, elapsed / 450);
      for (const dot of dots) {
        if (dotT <= 0) continue;
        const dist = dot.speed * dotT;
        const drop = 90 * dotT * dotT;
        const x = cx + Math.cos(dot.angle) * dist;
        const y = cy + Math.sin(dot.angle) * dist + drop;
        ctx.globalAlpha = Math.max(0, 1 - dotT / 1.4);
        ctx.fillStyle = dot.color;
        ctx.beginPath();
        ctx.arc(x, y, dot.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      if (elapsed < 700) {
        raf = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fire, reduced]);

  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
