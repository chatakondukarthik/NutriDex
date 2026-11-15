/**
 * Food resolution for AI-generated recipes.
 *
 * The model plans with dish-ingredient names in whatever form it likes
 * ("boneless chicken thigh"). This module turns those into concrete food
 * records, preferring what already exists in the app over new records:
 *
 *   1. exact normalized name/alias match against the local database
 *      (captured + seed, merged by listFoods())
 *   2. token-coverage fuzzy match against names and aliases
 *   3. USDA FoodData Central search — the best scoring hit is imported
 *      (only when persisting; preview reports it without writing)
 *   4. a provisional empty captured food, clearly marked, when nothing
 *      else has an answer
 *
 * Never silently invent nutrients for something we found or imported;
 * provisional foods start with unknown nutrients like every other
 * provisional (D-034).
 */

import type { Food } from "@/lib/nutrition/types";
import { prepareCapturedFood } from "@/lib/captured-food";
import { saveCapturedFood } from "@/lib/db/foods";
import { usdaToInput, type UsdaFood } from "@/lib/food-sources/usda";

export interface UsdaStubs {
  search: (query: string) => Promise<UsdaFood[]>;
  get: (fdcId: number) => Promise<UsdaFood | null>;
}

export interface LocalMatch {
  food: Food;
  score: number;
  /** Which local string matched — name or an alias. */
  via: "name" | "alias";
  matched: string;
}

export interface PlanFoodResolution {
  /** The name the plan used, trimmed. */
  name: string;
  status: "reused" | "usda-import" | "provisional";
  foodId: string | null;
  /** What it resolved to: matched local name, or USDA description. */
  matchedName: string | null;
  /** 0..1 token coverage for the chosen match (local or USDA). */
  score: number | null;
  /** USDA fdcId when the match came from FoodData Central. */
  fdcId?: number | null;
}

export interface ResolvedPlan {
  /** lowercased planned-name → food id (null only when a create failed). */
  map: Map<string, string | null>;
  resolutions: PlanFoodResolution[];
}

/* ------------------------------------------------------------------ */
/* token scoring                                                      */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "with", "fresh", "raw", "chopped",
  "sliced", "diced", "minced", "boneless", "skinless",
]);

export function foodTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Fraction of the query's tokens present in the candidate. */
export function scoreName(query: string, candidate: string): number {
  const q = new Set(foodTokens(query));
  if (q.size === 0) return 0;
  const c = new Set(foodTokens(candidate));
  let hit = 0;
  for (const token of q) if (c.has(token)) hit += 1;
  return hit / q.size;
}

/* ------------------------------------------------------------------ */
/* local matching                                                     */
/* ------------------------------------------------------------------ */

const LOCAL_THRESHOLD = 0.66;
const USDA_THRESHOLD = 0.5;

/**
 * Best local food for a planned name. Exact (normalized) and alias matches
 * are preferred over fuzzy ones at equal score; fuzzy needs ≥ 2/3 coverage.
 */
export function matchLocalFood(query: string, foods: Food[]): LocalMatch | null {
  const normalizedQuery = query.trim().toLowerCase();
  // 1) exact normalized match on name or alias
  for (const food of foods) {
    if (food.name.trim().toLowerCase() === normalizedQuery) {
      return { food, score: 1, via: "name", matched: food.name };
    }
    for (const alias of food.aliases ?? []) {
      if (alias.trim().toLowerCase() === normalizedQuery) {
        return { food, score: 1, via: "alias", matched: alias };
      }
    }
  }
  // 2) fuzzy token coverage
  let best: LocalMatch | null = null;
  for (const food of foods) {
    const candidates: Array<{ via: "name" | "alias"; matched: string }> = [
      { via: "name" as const, matched: food.name },
      ...(food.aliases ?? []).map((alias) => ({ via: "alias" as const, matched: alias })),
    ];
    for (const candidate of candidates) {
      const score = scoreName(normalizedQuery, candidate.matched);
      if (score < LOCAL_THRESHOLD) continue;
      if (!best || score > best.score) {
        best = { food, score, via: candidate.via, matched: candidate.matched };
      }
    }
  }
  return best;
}

/** Unique planned ingredient names, preserving plan order. */
export function planUniqueFoodNames(plan: { steps: Array<{ inputs: Array<{ foodName: string }> }> }): string[] {
  const seen = new Map<string, string>();
  for (const step of plan.steps) {
    for (const input of step.inputs) {
      const key = input.foodName.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, input.foodName.trim());
    }
  }
  return [...seen.values()];
}

/**
 * Resolve every ingredient in a plan. With `persist: false` nothing is
 * written — the USDA match is reported but not imported (preview).
 */
export async function resolvePlanFoods(
  plan: { steps: Array<{ inputs: Array<{ foodName: string }> }> },
  foods: Food[],
  opts: { persist?: boolean; usda?: UsdaStubs | false } = {},
): Promise<ResolvedPlan> {
  const persist = opts.persist ?? false;
  const usda =
    opts.usda === false
      ? null
      : (opts.usda ?? {
          search: (q: string) => import("@/lib/food-sources/usda").then((m) => m.searchUsda(q)),
          get: (id: number) => import("@/lib/food-sources/usda").then((m) => m.getUsdaFood(id)),
        });

  const names = planUniqueFoodNames(plan);
  const resolutions: PlanFoodResolution[] = [];
  const map = new Map<string, string | null>();

  for (const name of names) {
    const key = name.toLowerCase();

    const local = matchLocalFood(name, foods);
    if (local) {
      map.set(key, local.food.id);
      resolutions.push({
        name,
        status: "reused",
        foodId: local.food.id,
        matchedName: local.via === "alias" ? `${local.food.name} (alias "${local.matched}")` : local.food.name,
        score: local.score,
      });
      continue;
    }

    let usdaPick: { food: UsdaFood; score: number } | null = null;
    if (usda) {
      try {
        const hits = await usda.search(name);
        let bestHit: { food: UsdaFood; score: number } | null = null;
        for (const hit of hits) {
          const score = scoreName(name, hit.name);
          if (score >= USDA_THRESHOLD && (!bestHit || score > bestHit.score)) {
            bestHit = { food: hit, score };
          }
        }
        usdaPick = bestHit;
      } catch {
        usdaPick = null; // offline / rate-limited — fall through to provisional
      }
    }

    if (usdaPick) {
      if (persist && usda) {
        try {
          const detail = await usda.get(usdaPick.food.fdcId);
          const source = detail ?? usdaPick.food;
          const prepared = prepareCapturedFood(usdaToInput(source));
          if (prepared.ok) {
            const saved = saveCapturedFood(prepared.food, { allowDuplicate: false });
            if (!saved.ok && saved.duplicateOf) {
              map.set(key, saved.duplicateOf);
              resolutions.push({
                name,
                status: "reused",
                foodId: saved.duplicateOf,
                matchedName: `${prepared.food.name} (already in your foods)`,
                score: usdaPick.score,
              });
              continue;
            }
            if (saved.ok) {
              map.set(key, saved.food.id);
              resolutions.push({
                name,
                status: "usda-import",
                foodId: saved.food.id,
                matchedName: source.name,
                score: usdaPick.score,
                fdcId: source.fdcId,
              });
              continue;
            }
          }
        } catch {
          // fall through to provisional
        }
      } else {
        map.set(key, null); // resolved at confirm time
        resolutions.push({
          name,
          status: "usda-import",
          foodId: null,
          matchedName: usdaPick.food.name,
          score: usdaPick.score,
          fdcId: usdaPick.food.fdcId,
        });
        continue;
      }
    }

    if (persist) {
      const prepared = prepareCapturedFood({
        name,
        kind: "provisional",
        state: "raw",
        source: "ai-generated",
        nutrients: {},
      });
      if (prepared.ok) {
        const saved = saveCapturedFood(prepared.food, { allowDuplicate: false });
        if (!saved.ok && saved.duplicateOf) {
          map.set(key, saved.duplicateOf);
          resolutions.push({
            name,
            status: "reused",
            foodId: saved.duplicateOf,
            matchedName: `${prepared.food.name} (already in your foods)`,
            score: null,
          });
          continue;
        }
        if (saved.ok) {
          map.set(key, saved.food.id);
          resolutions.push({
            name,
            status: "provisional",
            foodId: saved.food.id,
            matchedName: null,
            score: null,
          });
          continue;
        }
      }
    }

    map.set(key, null);
    resolutions.push({ name, status: "provisional", foodId: null, matchedName: null, score: null });
  }

  return { map, resolutions };
}

