"use client";

import { AnimatePresence, motion, type Target, type TargetAndTransition } from "motion/react";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import DiaryPlate from "@/components/motifs/diary-plate";
import PlanPlate from "@/components/motifs/plan-plate";
import RecipesPlate from "@/components/motifs/recipes-plate";
import FoodsPlate from "@/components/motifs/foods-plate";
import ProfilePlate from "@/components/motifs/profile-plate";
import AboutPlate from "@/components/motifs/about-plate";
import GlossaryPlate from "@/components/motifs/glossary-plate";
import { VIEW_W, VIEW_H } from "@/components/motifs/motif-frame";
import { useMotionEnabled, useTheme } from "@/components/theme-provider";

/**
 * RouteMotif — the plate for the current room, and the fold (or bloom, or
 * rise, or spin, or unfurl, or slide) between rooms.
 *
 * One fixed-camera kitchen artifact per tab, always on at the bottom-right,
 * always quiet. On tab change exactly ONE transition plays — picked
 * uniformly at random from seven, never the same twice in a row. The plates
 * themselves never change; the kitchen's choreography does.
 *
 * The seven, all rho-transforms on one shared grammar (rim/spokes/centre,
 * hinge at the dabba corner):
 *   fold    — the pothi leaf turns (the house fold, rotateY)
 *   bloom   — the dabba lid lifts (clip-path iris from the corner)
 *   ember   — a spark drifts up (slide + fade)
 *   blossom — the toran flower opens (transform-only bloom with overshoot)
 *   spin    — the plate is spun home (in-plane rotate + settle)
 *   rim     — the plate settles in unhurriedly (the calmest of the seven)
 *   tawa    — the tava lid lifts (vertical slide, slight tilt)
 *
 * Every variant exits through the same quiet step-aside (opacity + scale),
 * so the unpredictability lives in one orchestrated beat, not seven.
 *
 * Gated three ways: the OS reduced-motion setting and Settings → Motion
 * (both via useMotionEnabled), and Settings → Chef's transition. Any of
 * them off means the plate swaps instantly — still present, never animated.
 *
 * Always aria-hidden, always pointer-events-none, always z-0.
 */

type PlateKey = "diary" | "plan" | "recipes" | "foods" | "profile" | "about" | "glossary";

const PLATES: Record<PlateKey, ComponentType> = {
  diary: DiaryPlate,
  plan: PlanPlate,
  recipes: RecipesPlate,
  foods: FoodsPlate,
  profile: ProfilePlate,
  about: AboutPlate,
  glossary: GlossaryPlate,
};

function plateKey(pathname: string): PlateKey {
  if (pathname.startsWith("/plan")) return "plan";
  if (pathname.startsWith("/recipes")) return "recipes";
  if (pathname.startsWith("/foods")) return "foods";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/about")) return "about";
  if (pathname.startsWith("/glossary")) return "glossary";
  return "diary";
}

function PlateSvg({ plateKeyName }: { plateKeyName: PlateKey }) {
  const Plate = PLATES[plateKeyName];
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="presentation" focusable="false">
      <Plate />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* The seven transitions                                                */
/* ------------------------------------------------------------------ */

interface Variant {
  id: string;
  /** Disabled variants stay in the array for reference; the picker never draws them. */
  disabled?: boolean;
  initial: Target;
  /** animate target (rest), with its own transition */
  to: TargetAndTransition;
  origin?: string;
  perspective?: boolean;
}

const VARIANTS: Variant[] = [
  {
    id: "fold",
    initial: { opacity: 0, rotateY: 74, rotateZ: 6, x: 28, y: 30 },
    to: {
      opacity: 1, rotateY: 0, rotateZ: 0, x: 0, y: 0,
      transition: { duration: 0.66, delay: 0.17, ease: [0.16, 1, 0.3, 1] },
    },
    origin: "85% 88%",
    perspective: true,
  },
  {
    id: "bloom",
    initial: { opacity: 0.1, scale: 0.82, clipPath: "circle(4% at 85% 88%)" },
    to: {
      opacity: 1, scale: 1, clipPath: "circle(130% at 85% 88%)",
      transition: { duration: 0.72, delay: 0.1, ease: [0.22, 1, 0.36, 1] },
    },
    origin: "85% 88%",
  },
  {
    id: "ember",
    initial: { opacity: 0, y: 64, scale: 0.94 },
    to: {
      opacity: 1, y: 0, scale: 1,
      transition: { duration: 0.6, delay: 0.14, ease: [0.16, 1, 0.3, 1] },
    },
    origin: "50% 100%",
  },
  {
    // Rewrote 2026-11-19: the old star-iris Marigold animated a 24-vertex
    // polygon clip-path, which engines stall on per-frame — it froze the
    // plate mid-reveal until the next switch. Same gesture (the toran
    // flower blossoming open), pure transforms.
    id: "blossom",
    initial: { opacity: 0.3, scale: 0.58, rotate: -16, y: 12 },
    to: {
      opacity: 1, scale: 1, rotate: 0, y: 0,
      transition: { duration: 0.72, delay: 0.1, ease: [0.18, 1.35, 0.32, 1] },
    },
    origin: "85% 88%",
  },
  {
    id: "spin",
    initial: { opacity: 0, rotate: -52, scale: 0.55, x: 44, y: 38 },
    to: {
      opacity: 1, rotate: 0, scale: 1, x: 0, y: 0,
      transition: { duration: 0.68, delay: 0.12, ease: [0.2, 1.35, 0.34, 1] },
    },
    origin: "85% 88%",
  },
  {
    id: "rim",
    initial: { opacity: 0, scale: 0.86, y: 8 },
    to: {
      opacity: 1, scale: 1, y: 0,
      transition: { duration: 0.78, delay: 0.16, ease: [0.2, 1, 0.3, 1] },
    },
    origin: "85% 88%",
  },
  {
    id: "tawa",
    initial: { opacity: 0, y: 150, rotate: 3.5 },
    to: {
      opacity: 1, y: 0, rotate: 0,
      transition: { duration: 0.62, delay: 0.13, ease: [0.2, 1.25, 0.32, 1] },
    },
    origin: "50% 100%",
  },
];

/** The universal step-aside — identical for every swap, never the memorable part. */
const EXIT: TargetAndTransition = {
  opacity: 0,
  scale: 0.9,
  y: 18,
  x: 12,
  transition: { duration: 0.16, ease: [0.55, 0, 0.85, 0.35] },
};

const ACTIVE_INDICES = VARIANTS.map((variant, index) => (variant.disabled ? -1 : index)).filter((i) => i >= 0);

function pickVariant(exclude: number): number {
  const options = ACTIVE_INDICES.filter((i) => i !== exclude);
  return options[Math.floor(Math.random() * options.length)];
}

export default function RouteMotif() {
  const pathname = usePathname();
  const key = plateKey(pathname);
  const motionEnabled = useMotionEnabled();
  const { settings } = useTheme();

  // A hidden tab throttles rAF, which freezes every exit animation and
  // stacks unmounted-but-never-completed plates forever. When the page is
  // not visible, swap instantly instead — the kitchen re-forms offstage.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    onChange();
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  const chef = motionEnabled && settings.transition && visible;

  // Random per navigation, never the same two swaps in a row. Derived
  // state during render — the entering plate commits in the same pass, so
  // no frame ever shows the wrong variant.
  const [nav, setNav] = useState({ path: pathname, variant: 0 });
  if (nav.path !== pathname) {
    setNav({ path: pathname, variant: pickVariant(nav.variant) });
  }

  if (!chef) {
    return (
      <div className="motif-frame" aria-hidden="true" data-variant="off">
        <PlateSvg plateKeyName={key} />
      </div>
    );
  }

  const variant = VARIANTS[nav.variant];

  // The dimming lives on .motif-frame (CSS, theme-aware); the transition
  // lives on the inner .motif-fold — inline motion opacity can never override it.
  return (
    <div className="motif-frame" aria-hidden="true">
      <AnimatePresence initial={false} mode="sync">
        <motion.div
          key={key}
          className="motif-fold"
          data-variant={variant.id}
          style={{
            transformPerspective: variant.perspective ? 1100 : undefined,
            transformOrigin: variant.origin ?? "85% 88%",
          }}
          initial={variant.initial}
          animate={variant.to}
          exit={EXIT}
        >
          <PlateSvg plateKeyName={key} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
