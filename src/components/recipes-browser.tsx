"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmt } from "@/lib/format";
import { filterRecipes, ingredientFacets } from "@/lib/recipe-filter";
import { ProvenanceChip } from "@/components/provenance-chip";
import { recipeProvenance } from "@/lib/provenance";

export type Recipe = {
  id: string;
  name: string;
  currentVersionNo?: number | null;
  currentVersionLabel?: string | null;
  kcalPerServing: number | null;
  servings: number | null;
  versionCount: number;
  kind?: "dish" | "component" | string;
  /** Food ids used in the current version. */
  ingredientIds: string[];
  /** Displayable ingredient names (unknown food ids are skipped). */
  ingredients: { id: string; name: string }[];
  /** Lowercased name + ingredient haystack for search. */
  haystack: string;
};

const KINDS = [
  { value: "All", label: "All" },
  { value: "dish", label: "Dishes" },
  { value: "component", label: "Components" },
];

export function RecipesBrowser({ recipes }: { recipes: Recipe[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("All");
  const [ingredient, setIngredient] = useState("");

  const facets = useMemo(
    () => ingredientFacets(recipes, new Map(recipes.flatMap((r) => r.ingredients.map((i) => [i.id, i.name])))),
    [recipes],
  );

  const filtered = useMemo(
    () =>
      filterRecipes(recipes, query, ingredient || null).filter(
        (recipe) => kind === "All" || recipe.kind === kind,
      ),
    [recipes, query, kind, ingredient],
  );

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search recipes or ingredients…"
          aria-label="Search recipes"
          className="min-w-[220px] flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
        />
        <select
          value={ingredient}
          onChange={(event) => setIngredient(event.target.value)}
          aria-label="Filter by ingredient"
          className="h-9 max-w-[180px] rounded-lg border border-line bg-bg px-2 text-xs"
        >
          <option value="">Any ingredient</option>
          {facets.map((facet) => (
            <option key={facet.id} value={facet.id}>
              {facet.name} ({facet.count})
            </option>
          ))}
        </select>
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
          {ingredient
            ? `No recipes use ${facets.find((f) => f.id === ingredient)?.name ?? "that ingredient"}${query ? ` and match “${query}”` : ""}.`
            : `No recipes match “${query}”.`}
        </p>
      ) : (
        <ul className="mt-3 max-h-[600px] grid gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((recipe) => (
            <li
              key={recipe.id}
              className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:border-accent/30"
            >
              <Link href={`/recipes/${recipe.id}`} className="block flex-1 p-4 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold leading-snug">{recipe.name}</h2>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <ProvenanceChip provenance={recipeProvenance(recipe.currentVersionLabel)} />
                    <span className="rounded-md bg-ink/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-ink/45">
                      v{recipe.currentVersionNo ?? 1}
                    </span>
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
              {recipe.ingredients.length > 0 && (
                <p className="mt-auto flex flex-wrap gap-1 border-t border-line/60 px-4 py-2">
                  {recipe.ingredients.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setIngredient(item.id)}
                      aria-pressed={ingredient === item.id}
                      title={`Show recipes with ${item.name}`}
                      className={`rounded-full px-2 py-0.5 text-[10px] transition ${
                        ingredient === item.id
                          ? "bg-accent/15 text-accent"
                          : "bg-ink/[0.06] text-ink/55 hover:bg-accent/10 hover:text-accent"
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                  {recipe.ingredients.length > 4 && (
                    <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] text-ink/40">
                      +{recipe.ingredients.length - 4}
                    </span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
