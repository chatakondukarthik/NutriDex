"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Food } from "@/lib/nutrition/types";
import { searchFoods } from "@/lib/nutrition/food-search";
import { toGrams, parseUnitKey } from "@/lib/nutrition/units";
import { defaultAmountFor } from "@/lib/nutrition/defaults";
import { serializeFragment } from "@/lib/recipe-fragment";
import { BulkEstimateButton } from "@/components/bulk-estimate-button";
import { Spotlight } from "@/components/spotlight";
import { AnimatePresence, motion } from "motion/react";
import { SPRING } from "@/lib/motion/tokens";
import { ProvenanceChip } from "@/components/provenance-chip";
import { foodProvenance } from "@/lib/provenance";
import { NUTRIENT_CODES } from "@/lib/nutrition/types";

const CATEGORIES = ["All", "Dairy", "Grains", "Vegetables", "Fruits", "Legumes", "Oils", "Nuts", "Meat", "Seafood", "Spices", "Beverages", "Custom"];

export function FoodsBrowser({
  foods,
  aiEnabled,
  hasKey,
}: {
  foods: Food[];
  aiEnabled: boolean;
  hasKey: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [mineOnly, setMineOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const results = useMemo(() => {
    let list = searchFoods(foods, query);
    if (category !== "All") list = list.filter((f) => f.category === category);
    if (mineOnly) list = list.filter((f) => !!f.source);
    return list;
  }, [foods, query, category, mineOnly]);

  const categories = useMemo(() => {
    const set = new Set(foods.map((f) => f.category));
    return ["All", ...Array.from(set).filter((c) => c !== "All").sort()];
  }, [foods]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  function flashNotice(text: string) {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
  }

  const pendingFoods = useMemo(
    () =>
      foods
        .map((food) => ({
          id: food.id,
          name: food.name,
          captured: !!food.source,
          missingCodes: NUTRIENT_CODES.filter((code) => food.nutrients[code]?.amount == null),
        }))
        .filter((food) => food.captured && food.missingCodes.length > 0),
    [foods],
  );

  const visibleIds = results.map((food) => food.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));
  const selectedCount = selected.size;

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Copy the selected foods as a recipe fragment; paste it on the canvas. */
  function copySelected() {
    const chosen = foods.filter((food) => selected.has(food.id));
    if (chosen.length === 0) return;

    const nodes = chosen.map((food, index) => {
      // Carry each food's own default (portions, serving size, rules)
      // so the pasted canvas node opens with a sensible quantity.
      const chosenAmount = defaultAmountFor(food);
      const parsed = parseUnitKey(chosenAmount.unit);
      const converted = toGrams(food, {
        amount: chosenAmount.amount,
        unit: parsed.unit,
        portionLabel: parsed.portionLabel,
      });
      return {
        id: food.id,
        type: "food" as const,
        position: { x: (index % 4) * 240, y: Math.floor(index / 4) * 170 },
        data: {
          foodId: food.id,
          label: food.name,
          grams: converted.ok ? converted.grams : chosenAmount.amount,
          amount: chosenAmount.amount,
          unit: chosenAmount.unit,
        },
      };
    });
    const json = serializeFragment(nodes, [], new Set(chosen.map((food) => food.id)));
    if (!json) return;

    try {
      navigator.clipboard?.writeText(json).catch(() => {});
    } catch {
      /* clipboard unavailable in some contexts */
    }
    flashNotice(
      `Copied ${chosen.length} food${chosen.length === 1 ? "" : "s"} as JSON — open a recipe and use “Paste JSON…”.`,
    );
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search foods as you type…"
          aria-label="Search foods"
          className="flex-1 min-w-[200px] rounded-md border border-line bg-bg px-3 py-2 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="rounded-md border border-line bg-bg px-2 py-2 text-sm"
        >
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          My foods only
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
        <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-ink/70">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
            }}
            onChange={toggleAll}
            aria-label={`Select all ${visibleIds.length} shown`}
          />
          Select all{query || category !== "All" || mineOnly ? ` shown (${visibleIds.length})` : ` (${visibleIds.length})`}
        </label>
        <span aria-live="polite" className="text-[11px] tabular text-ink/45">
          {selectedCount} selected
        </span>
        <BulkEstimateButton
          pendingFoods={pendingFoods}
          selectedIds={selected}
          aiEnabled={aiEnabled}
          hasKey={hasKey}
        />
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[11px] font-medium text-muted transition hover:text-ink"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={copySelected}
          disabled={selectedCount === 0}
          title={selectedCount === 0 ? "Select at least one food" : "Copy the selection as a recipe fragment (paste it on the canvas)"}
          className="ml-auto rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-fg transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          Copy selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
      </div>

      {results.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-surface p-6 text-sm text-muted">
          No foods match. Try a different spelling or filter, or add a new food.
        </p>
      ) : (
        <ul className="mt-4 grid max-h-[70vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {results.map((food, index) => {
            const estimatedCount = Object.values(food.nutrients).filter(
              (value) => value?.status === "estimated",
            ).length;
            return (
            <Spotlight
              as="li"
              key={food.id}
              className="flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3 text-sm shadow-card transition-[box-shadow,border-color] duration-200 ease-out hover:border-accent/35 hover:shadow-plate"
              index={index}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(food.id)}
                onChange={() => toggleOne(food.id)}
                aria-label={`Select ${food.name}`}
              />
              <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                <div>
                  <p className="font-display text-[13px] font-semibold tracking-tight text-ink">{food.name}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <ProvenanceChip provenance={foodProvenance(food.source ?? null, food.sourceKind ?? null)} />
                    {estimatedCount > 0 && (
                      <span
                        title={`${estimatedCount} value${estimatedCount === 1 ? "" : "s"} are AI estimates`}
                        className="rounded bg-warn-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warn-ink"
                      >
                        est. {estimatedCount}
                      </span>
                    )}
                    <span>
                      {food.category} · {food.kind} · {food.state}
                      {food.aliases?.length ? ` · ${food.aliases.slice(0, 3).join(", ")}` : ""}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Link href={`/foods/${food.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                    View
                  </Link>
                  {food.source ? (
                    <Link href={`/foods/${food.id}/edit`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                      Edit
                    </Link>
                  ) : null}
                </div>
              </div>
            </Spotlight>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">{results.length} of {foods.length} foods.</p>

      <AnimatePresence>
        {notice && (
          <motion.p
            role="status"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ ...SPRING.settle }}
            className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-1.5 text-[11px] text-ink shadow-card"
          >
            {notice}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
