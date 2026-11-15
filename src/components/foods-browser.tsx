"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Food } from "@/lib/nutrition/types";
import { searchFoods } from "@/lib/nutrition/food-search";

export function FoodsBrowser({ foods }: { foods: Food[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchFoods(foods, query), [foods, query]);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search foods as you type…"
        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm"
      />
      {results.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-surface p-6 text-sm text-muted">
          No foods match. Try a different spelling, or add a new food.
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
                {food.source === "manual" || food.source === "llm" || food.source === "label" ? (
                  <Link href={`/foods/${food.id}/edit`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                    Edit
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
