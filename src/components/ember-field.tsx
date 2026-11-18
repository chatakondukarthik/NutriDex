"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useReducedMotion as useMotionPreference } from "motion/react";

/**
 * The kitchen breathes — a fixed, route-aware ambient canvas behind every page.
 *
 * Each screen gets its own ingredient in motion, Indian kitchen grammar:
 *   /          the tawa    — ember sparks rising off the daily fire
 *   /plan      marigold    — petals falling for the week of harvest to come
 *   /recipes   whole spice — star anise drifting down through the masala dabba
 *   /foods     the rack    — turmeric dust drifting sideways through a shaft of light
 *   /profile   chai steam  — soft wisps rising off the household's steadied cup
 *   elsewhere  quiet embers — a low burner, almost still
 *
 * Pure canvas, one rAF loop, transform-free draws, ≤ 36 particles.
 * Motion off / prefers-reduced-motion renders nothing — the CSS washes
 * still carry the warmth.
 */

type ParticleKind = "spark" | "petal" | "anise" | "dust" | "steam" | "dim";

interface AmbientTheme {
  count: number;
  kind: ParticleKind;
}

const THEMES: Array<{ match: (path: string) => boolean; theme: AmbientTheme }> = [
  { match: (p) => p === "/", theme: { count: 33, kind: "spark" } },
  { match: (p) => p.startsWith("/plan"), theme: { count: 19, kind: "petal" } },
  { match: (p) => p.startsWith("/recipes"), theme: { count: 16, kind: "anise" } },
  { match: (p) => p.startsWith("/foods"), theme: { count: 29, kind: "dust" } },
  { match: (p) => p.startsWith("/profile"), theme: { count: 13, kind: "steam" } },
];

function themeFor(pathname: string): AmbientTheme {
  for (const { match, theme } of THEMES) if (match(pathname)) return theme;
  return { count: 18, kind: "dim" };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  vr: number;
  size: number;
  alpha: number;
  phase: number;
  color: string;
}

const EMBER = ["#E8A33D", "#C4531F", "#D9A03C", "#EBC878"];
const MARIGOLD = ["#F2A01E", "#E8871A", "#D97A12", "#F6C445"];
const ANISE = ["#4A3320", "#3A2A1A", "#5C4326"];
const DUST = ["#E8A33D", "#D9A03C", "#C98B2E", "#8A5A1B"];
const STEAM = ["#F3E9DA"];

function makeParticle(kind: ParticleKind, width: number, height: number): Particle {
  const x = Math.random() * width;
  const y = Math.random() * height;
  switch (kind) {
    case "spark":
      return {
        x, y,
        vx: 0, vy: 0.14 + Math.random() * 0.3,
        angle: 0, vr: 0, phase: Math.random() * Math.PI * 2,
        size: 0.7 + Math.random() * 2, alpha: 0.17 + Math.random() * 0.35,
        color: EMBER[(Math.random() * EMBER.length) | 0],
      };
    case "petal":
      return {
        x, y,
        vx: 0.12 + Math.random() * 0.25, vy: 0.3 + Math.random() * 0.35,
        angle: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.02,
        phase: Math.random() * Math.PI * 2,
        size: 3.4 + Math.random() * 3.6, alpha: 0.53 + Math.random() * 0.41,
        color: MARIGOLD[(Math.random() * MARIGOLD.length) | 0],
      };
    case "anise":
      return {
        x, y,
        vx: 0.08 + Math.random() * 0.2, vy: 0.1 + Math.random() * 0.18,
        angle: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.012,
        phase: Math.random() * Math.PI * 2,
        size: 5 + Math.random() * 4.5, alpha: 0.78 + Math.random() * 0.22,
        color: ANISE[(Math.random() * ANISE.length) | 0],
      };
    case "dust":
      return {
        x, y,
        vx: 0.25 + Math.random() * 0.5, vy: (Math.random() - 0.5) * 0.06,
        angle: 0, vr: 0, phase: Math.random() * Math.PI * 2,
        size: 0.5 + Math.random() * 1.4, alpha: 0.10 + Math.random() * 0.22,
        color: DUST[(Math.random() * DUST.length) | 0],
      };
    case "steam":
      return {
        x, y: height + Math.random() * height * 0.25,
        vx: (Math.random() - 0.5) * 0.12, vy: 0.18 + Math.random() * 0.22,
        angle: 0, vr: 0, phase: Math.random() * Math.PI * 2,
        size: 8 + Math.random() * 16, alpha: 0.055 + Math.random() * 0.08,
        color: STEAM[0],
      };
    case "dim":
      return {
        x, y,
        vx: 0, vy: 0.06 + Math.random() * 0.1,
        angle: 0, vr: 0, phase: Math.random() * Math.PI * 2,
        size: 0.6 + Math.random() * 1.4, alpha: 0.085 + Math.random() * 0.14,
        color: EMBER[(Math.random() * EMBER.length) | 0],
      };
  }
}

export default function EmberField() {
  const pathname = usePathname();
  const prefersReduced = useMotionPreference();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (prefersReduced) return;
    if (typeof document !== "undefined" && document.documentElement.dataset.motion === "off") return;

    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const canvas: HTMLCanvasElement = canvasEl;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;

    const theme = themeFor(pathname);

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: theme.count }, () => makeParticle(theme.kind, width, height));

    function drawPetal(p: Particle, t: number) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle + Math.sin(t * 0.001 + p.phase) * 0.35);
      ctx.scale(1, 0.62);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawAnise(p: Particle) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      for (let i = 0; i < 16; i += 1) {
        const radius = i % 2 === 0 ? p.size : p.size * 0.38;
        const angle = (Math.PI * 2 * i) / 16;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawSteam(p: Particle, t: number) {
      const sway = Math.sin(t * 0.0006 + p.phase) * 8;
      const grow = Math.min(1.6, 1 + (height - p.y) / (height * 1.2));
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x + sway, p.y, p.size * grow, 0, Math.PI * 2);
      ctx.fill();
    }

    let raf = 0;
    const started = performance.now();

    function frame(now: number) {
      const t = now - started;
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        switch (theme.kind) {
          case "spark":
          case "dim":
            p.y -= p.vy;
            p.phase += 0.008;
            if (p.y < -8) {
              p.y = height + 8;
              p.x = Math.random() * width;
            }
            ctx.globalAlpha = p.alpha * (0.7 + 0.3 * Math.sin(t * 0.004 + p.phase));
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x + Math.sin(p.phase) * 9, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            break;
          case "petal":
            p.x += p.vx;
            p.y += p.vy;
            p.angle += p.vr;
            p.phase += 0.01;
            if (p.y > height + 12 || p.x > width + 12) {
              p.y = -12;
              p.x = Math.random() * width * 0.9;
            }
            ctx.globalAlpha = p.alpha;
            drawPetal(p, t);
            break;
          case "anise":
            p.x += p.vx;
            p.y += p.vy;
            p.angle += p.vr;
            p.phase += 0.008;
            if (p.y > height + 16) {
              p.y = -16;
              p.x = Math.random() * width;
            }
            if (p.x > width + 16) p.x = -16;
            drawAnise(p);
            break;
          case "dust":
            p.x += p.vx;
            p.phase += 0.006;
            if (p.x > width + 6) {
              p.x = -6;
              p.y = Math.random() * height;
            }
            ctx.globalAlpha = p.alpha * (0.75 + 0.25 * Math.sin(t * 0.002 + p.phase));
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y + Math.sin(p.phase) * 4, p.size, 0, Math.PI * 2);
            ctx.fill();
            break;
          case "steam":
            p.y -= p.vy;
            p.x += p.vx;
            p.phase += 0.006;
            if (p.y < -p.size * 2) {
              p.y = height + p.size;
              p.x = Math.random() * width;
            }
            ctx.globalAlpha = p.alpha;
            drawSteam(p, t);
            break;
        }
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, [pathname, prefersReduced]);

  if (prefersReduced) return null;

  return (
    <motion.canvas
      key={pathname}
      ref={canvasRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45 }}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
