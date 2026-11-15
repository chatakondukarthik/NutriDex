"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmt } from "@/lib/format";

type Recipe = {
  id: string;
  name: string;
  currentVersionNo?: number | null;
  currentVersionLabel?: string | null;
  kcalPerServing: number | null;
  servings: number | null;
  versionCount: number;
  kind?: "dish" | "component" | string;
};

const KINDS = [
  { value: "All", label: "All" },
  { value: "dish", label: "Dishes" },
  { value: "component", label: "Components" },
];

export function RecipesBrowser({ recipes }: { recipes: Recipe[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("All");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((recipe) => {
      if (kind !== "All" && recipe.kind !== kind) return false;
      if (!q) return true;
      return recipe.name.toLowerCase().includes(q);
    });
  }, [recipes, query, kind]);

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search recipes by name…"
          aria-label="Search recipes"
          className="min-w-[220px] flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        <div className="flex h-9 items-center gap-0.5 rounded-lg bg-ink/[0.06] p-0.5 text-xs">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              aria-pressed={kind === option.value}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                kind === option.value
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink/35">{filtered.length} / {recipes.length}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
          No recipes match “{query}”.
        </p>
      ) : (
        <ul className="mt-3 max-h-[600px] grid gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((recipe) => (
            <li key={recipe.id}>
              <Link
                href={`/recipes/${recipe.id}`}
                className="block h-full rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-accent/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold leading-snug">{recipe.name}</h2>
                  <span className="shrink-0 rounded-md bg-ink/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-ink/45">
                    v{recipe.currentVersionNo ?? 1}
                  </span>
                </div>
                {recipe.currentVersionLabel && (
                  <p className="mt-0.5 truncate text-[11px] text-ink/40">{recipe.currentVersionLabel}</p>
                )}
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="tabular text-xl font-semibold leading-none">
                    {fmt(recipe.kcalPerServing, 0)}
                  </span>
                  <span className="text-[11px] text-ink/40">kcal / serving</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-ink/40">
                  <span>
                    {fmt(recipe.servings, 0)}{" "}
                    {recipe.servings === 1 ? "serving" : "servings"}
                  </span>
                  <span>
                    {recipe.versionCount} {recipe.versionCount === 1 ? "version" : "versions"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
