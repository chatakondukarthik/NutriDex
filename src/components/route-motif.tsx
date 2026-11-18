"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
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
 * RouteMotif — the plate for the current room, and the fold between rooms.
 *
 * One fixed-camera kitchen artifact per tab, always on at the bottom-right,
 * always quiet. On tab change the old plate folds away like a leaf being
 * put back into the stack (rotateY + rotateZ toward the plate corner, the
 * fold hinge), and the new plate unfolds out of the same hinge a beat later.
 * The grammar is the page-turn of the olam pothi the Recipes room is drawn
 * from — the transition is the recipe book closing on one room and opening
 * on the next.
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

export default function RouteMotif() {
  const pathname = usePathname();
  const key = plateKey(pathname);
  const motionEnabled = useMotionEnabled();
  const { settings } = useTheme();
  const chef = motionEnabled && settings.transition;

  if (!chef) {
    return (
      <div className="motif-frame" aria-hidden="true">
        <PlateSvg plateKeyName={key} />
      </div>
    );
  }

  // The dimming lives on .motif-frame (CSS, theme-aware); the fold lives on
  // the inner .motif-fold — inline motion opacity can never override it.
  return (
    <div className="motif-frame" aria-hidden="true">
      <AnimatePresence initial={false} mode="sync">
        <motion.div
          key={key}
          className="motif-fold"
          style={{ transformPerspective: 1100, transformOrigin: "85% 88%" }}
          initial={{ opacity: 0, rotateY: 74, rotateZ: 6, x: 28, y: 30 }}
          animate={{
            opacity: 1,
            rotateY: 0,
            rotateZ: 0,
            x: 0,
            y: 0,
            transition: { duration: 0.66, delay: 0.17, ease: [0.16, 1, 0.3, 1] },
          }}
          exit={{
            opacity: 0,
            rotateY: -80,
            rotateZ: -8,
            x: 34,
            y: 34,
            transition: { duration: 0.38, ease: [0.55, 0, 0.8, 0.35] },
          }}
        >
          <PlateSvg plateKeyName={key} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
