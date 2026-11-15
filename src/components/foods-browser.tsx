"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Food } from "@/lib/nutrition/types";
import { searchFoods } from "@/lib/nutrition/food-search";

const CATEGORIES = ["All", "Dairy", "Grains", "Vegetables", "Fruits", "Legumes", "Oils", "Nuts", "Meat", "Seafood", "Spices", "Beverages", "Custom"];

export function FoodsBrowser({ foods }: { foods: Food[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [mineOnly, setMineOnly] = useState(false);

  const results = useMemo(() => {
    let list = searchFoods(foods, query);
    if (category !== "All") list = list.filter((f) => f.category === category);
    if (mineOnly) list = list.filter((f) => f.source && f.source !== "USDA FDC SR Legacy (seed)" && f.source !== "IFCT 2017 (seed, unverified)");
    // captured foods carry a source; seed foods do not have source set in the Food type from seeds? They do not set source. Treat no-source as built-in.
    if (mineOnly) list = list.filter((f) => !!f.source);
    return list;
  }, [foods, query, category, mineOnly]);

  const categories = useMemo(() => {
    const set = new Set(foods.map((f) => f.category));
    return ["All", ...Array.from(set).filter((c) => c !== "All").sort()];
  }, [foods]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search foods as you type…"
          className="flex-1 min-w-[200px] rounded-md border border-line bg-bg px-3 py-2 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-line bg-bg px-2 py-2 text-sm"
        >
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          My foods only
        </label>
      </div>

      {results.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-surface p-6 text-sm text-muted">
          No foods match. Try a different spelling or filter, or add a new food.
        </p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {results.map((food) => (
            <li key={food.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{food.name}</p>
                  <p className="text-xs text-muted">
                    {food.category} · {food.kind} · {food.state}
                    {food.aliases?.length ? ` · ${food.aliases.slice(0, 3).join(", ")}` : ""}
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
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">{results.length} of {foods.length} foods.</p>
    </div>
  );
}
