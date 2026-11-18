"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Ember / sesame burst for earned moments only.
 *
 * One firing per mount, ≤ 24 ember particles, ~900 ms, transform-free.
 * No engine, no assets — a fixed canvas, a particle list, one rAF loop.
 * Parent sets `fire` when the condition is met (e.g. energy crosses 100 %).
 * Under reduced motion it renders nothing.
 */
export default function SparkBurst({ fire }: { fire: boolean }) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (!fire || fired.current || reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    fired.current = true;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 240;
    const height = parent?.clientHeight ?? 240;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;
    ctx.scale(dpr, dpr);

    const COLORS = ["#E8A33D", "#C4531F", "#F0E4C8", "#E9B454", "#8A5A1B"];
    const originX = width * 0.5;
    const originY = height * 0.58;

    const particles = Array.from({ length: 24 }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = 60 + Math.random() * 150;
      return {
        x: originX + (Math.random() - 0.5) * 22,
        y: originY + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 1.4 + Math.random() * 2.6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 6,
        life: 1,
        decay: 0.011 + Math.random() * 0.008,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        hexagon: Math.random() < 0.35,
      };
    });

    let raf = 0;
    const started = performance.now();
    function frame(now: number) {
      const elapsed = now - started;
      ctx.clearRect(0, 0, width, height);
      let alive = 0;
      for (const p of particles) {
        p.vy += 340 * (1 / 60); // ember gravity
        p.x += p.vx / 60;
        p.y += p.vy / 60;
        p.rot += p.vr / 60;
        p.life -= p.decay;
        if (p.life <= 0) continue;
        alive += 1;
        const alpha = Math.max(0, Math.min(1, p.life * 1.1));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.hexagon) {
          ctx.beginPath();
          for (let i = 0; i < 6; i += 1) {
            const a = (Math.PI / 3) * i;
            const px = Math.cos(a) * p.r;
            const py = Math.sin(a) * p.r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (alive > 0 && elapsed < 1600) {
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
