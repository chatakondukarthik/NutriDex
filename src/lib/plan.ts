import { combine, rollup, scaleRollup, type Rollup } from "@/lib/nutrition/engine";
import type { Food } from "@/lib/nutrition/types";

/**
 * The plan's shape, and the arithmetic that turns it into a day.
 *
 * Pure: no database, no React. The board, the tests and the server all
 * use these functions, so "what a day contains" has exactly one
 * definition.
 */

export const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;

export type Slot = (typeof SLOTS)[number];

export const SLOT_LABELS: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

/** Human quantity for an entry: "100 g", "2 kg", "3 eggs", "1 katori", or "2 servings". */
export function entryQty(entry: PlanEntry): string {
  if (entry.foodId) {
    if (entry.amount != null && entry.unit) {
      if (entry.unit.startsWith("portion:")) {
        const label = entry.unit.slice("portion:".length).replace(/^1\s+/, "");
        return `${fmtQtyText(entry.amount)} ${label}${entry.amount === 1 ? "" : ""}`;
      }
      const unit = entry.unit.replace(/_/g, " ");
      return `${fmtQtyText(entry.amount)} ${unit}`;
    }
    return `${Math.round(entry.grams ?? 0)} g`;
  }
  return `${fmtQtyText(entry.servings ?? 0)} ${entry.servings === 1 ? "serving" : "servings"}`;
}

function fmtQtyText(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : "—";
}

export interface PlanEntry {
  id: string;
  planId: string;
  day: string;
  slot: Slot;
  position: number;
  /** A food, or a pinned recipe version. Never both. */
  foodId: string | null;
  recipeVersionId: string | null;
  /** Food: resolved grams. */
  grams: number | null;
  /** Food: what the user chose, kept as evidence. Null when entered as grams. */
  amount: number | null;
  unit: string | null;
  /** Recipe: how many servings of the pinned version. */
  servings: number | null;
}

/** A recipe as it can be planned: a specific version and its snapshot. */
export interface PlanRecipeOption {
  recipeId: string;
  name: string;
  versionId: string;
  versionNo: number;
  /** Optional human name for the version. */
  label: string | null;
  /** True for the recipe's current version. */
  isCurrent: boolean;
  servings: number;
  perServing: Rollup;
}

/** How a planned recipe version is written in the UI. */
export function versionName(option: PlanRecipeOption): string {
  return option.label
    ? `${option.name} · ${option.label}`
    : `${option.name} · v${option.versionNo}`;
}

/**
 * One entry's contribution.
 *
 * A food is rolled up from its per-100 g record. A recipe is scaled from
 * the snapshot stored with the version, never recomputed — that is what
 * keeps a saved plan stable when a food record is corrected (D-024).
 */
export function entryRollup(
  entry: PlanEntry,
  foodById: Map<string, Food>,
  recipeByVersion: Map<string, PlanRecipeOption>,
): Rollup | null {
  if (entry.foodId) {
    const food = foodById.get(entry.foodId);
    if (!food || entry.grams == null) return null;
    return rollup([{ label: food.name, profile: food.nutrients, grams: entry.grams }]);
  }

  if (entry.recipeVersionId) {
    const recipe = recipeByVersion.get(entry.recipeVersionId);
    if (!recipe || entry.servings == null) return null;
    return scaleRollup(recipe.perServing, entry.servings);
  }

  return null;
}

/** Combine a day's entries. An empty day is `unknown`, not zero. */
export function dayRollup(
  entries: PlanEntry[],
  foodById: Map<string, Food>,
  recipeByVersion: Map<string, PlanRecipeOption>,
): Rollup {
  const results: Rollup[] = [];
  for (const entry of entries) {
    const result = entryRollup(entry, foodById, recipeByVersion);
    if (result) results.push(result);
  }
  return combine(results);
}

/** Entries for one day, ordered by slot then position. */
export function entriesForDay(entries: PlanEntry[], day: string): PlanEntry[] {
  const slotOrder = new Map(SLOTS.map((slot, index) => [slot, index]));
  return entries
    .filter((entry) => entry.day === day)
    .sort(
      (a, b) =>
        (slotOrder.get(a.slot) ?? 0) - (slotOrder.get(b.slot) ?? 0) || a.position - b.position,
    );
}

/* ------------------------------------------------------------- calendar */

/** ISO calendar day arithmetic, done in UTC so a timezone cannot shift it. */
export function addDays(day: string, delta: number): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + delta);
  return toDay(date);
}

/** Monday of the week containing `day`. Weeks start on Monday. */
export function weekStart(day: string): string {
  const date = parseDay(day);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return toDay(date);
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function weekdayShort(day: string): string {
  return parseDay(day).toLocaleDateString("en-IN", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function dayOfMonth(day: string): number {
  return parseDay(day).getUTCDate();
}

function parseDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
